"""Tests for deterministic structural scoring and paid behavioral gates."""

import json
import os
import subprocess
import sys

from lab.eval.dimensions import behavioral
from lab.eval.schemas import EvalDimension
from lab.eval import trigger_scorer


def test_structural_scoring_ignores_ambient_trigger_cache(tmp_path, monkeypatch):
    cache = tmp_path / "demo.json"
    cache.write_text(
        json.dumps(
            {
                "accuracy": 0.0,
                "precision": 0.0,
                "recall": 0.0,
                "correct": 0,
                "total": 10,
                "tp": 0,
                "fp": 5,
                "fn": 5,
            }
        )
    )
    monkeypatch.setattr(behavioral, "TRIGGERS_RESULTS_DIR", str(tmp_path))
    monkeypatch.delenv(behavioral.CACHE_OPT_IN_ENV, raising=False)

    dimension = EvalDimension(name="behavioral", weight=0.1, checks=[])
    result = behavioral.score("", dimension, skill_path="/skills/demo/SKILL.md")

    assert result.score == 1.0
    assert "disabled for deterministic scoring" in result.assertions[0].evidence


def test_trigger_cache_requires_explicit_opt_in(tmp_path, monkeypatch):
    cache = tmp_path / "demo.json"
    cache.write_text(
        json.dumps(
            {
                "accuracy": 0.5,
                "precision": 1.0,
                "recall": 0.0,
                "correct": 5,
                "total": 10,
                "tp": 0,
                "fp": 0,
                "fn": 5,
            }
        )
    )
    monkeypatch.setattr(behavioral, "TRIGGERS_RESULTS_DIR", str(tmp_path))
    monkeypatch.setenv(behavioral.CACHE_OPT_IN_ENV, "1")

    dimension = EvalDimension(name="behavioral", weight=0.1, checks=[])
    result = behavioral.score("", dimension, skill_path="/skills/demo/SKILL.md")

    assert result.score < 1.0
    assert result.failed == 2


def test_invalid_canonical_description_fails_preflight(tmp_path, monkeypatch):
    skill_dir = tmp_path / "skills" / "demo"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text("---\nname: demo\ndescription:\n---\n")
    monkeypatch.setattr(trigger_scorer, "PLUGIN_ROOT", str(tmp_path))

    try:
        trigger_scorer.load_all_descriptions()
    except ValueError as error:
        assert "demo" in str(error)
    else:
        raise AssertionError("invalid canonical description passed preflight")


def test_skills_below_threshold_are_ordered_worst_first():
    results = {
        "passing": {"accuracy": 0.75},
        "middle": {"accuracy": 0.6},
        "worst": {"accuracy": 0.4},
    }

    assert trigger_scorer.skills_below_threshold(results, 0.75) == [
        ("worst", 0.4),
        ("middle", 0.6),
    ]


def test_single_skill_cli_fails_below_threshold(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["trigger_scorer", "--skill", "demo", "--summary"])
    monkeypatch.setattr(trigger_scorer, "load_all_descriptions", lambda: {"demo": "Demo"})
    monkeypatch.setattr(
        trigger_scorer,
        "load_trigger_file",
        lambda _name: {"should_trigger": ["demo"], "should_not_trigger": []},
    )
    monkeypatch.setattr(
        trigger_scorer,
        "score_skill_triggers",
        lambda *_args, **_kwargs: {"accuracy": 0.74, "precision": 1.0, "recall": 0.5},
    )

    assert trigger_scorer.main() == 1


def test_judge_retries_transient_cli_failure(monkeypatch):
    attempts = iter(
        [
            subprocess.CompletedProcess([], 1, stdout="", stderr="temporary failure"),
            subprocess.CompletedProcess([], 0, stdout="testing\n", stderr=""),
        ]
    )
    monkeypatch.setattr(trigger_scorer.subprocess, "run", lambda *_args, **_kwargs: next(attempts))

    assert trigger_scorer.ask_model({"testing": "Test Elixir code"}, "write a test") == ["testing"]


def test_judge_failure_is_not_scored_as_no_skill(monkeypatch):
    failure = subprocess.CompletedProcess([], 1, stdout="", stderr="authentication failed")
    monkeypatch.setattr(trigger_scorer.subprocess, "run", lambda *_args, **_kwargs: failure)

    try:
        trigger_scorer.ask_model({"testing": "Test Elixir code"}, "write a test")
    except trigger_scorer.JudgeInvocationError as error:
        assert "authentication failed" in str(error)
    else:
        raise AssertionError("judge infrastructure failure was silently scored")


def test_judge_receives_complete_descriptions(monkeypatch):
    captured = {}

    def run(command, **_kwargs):
        captured["prompt"] = command[2]
        return subprocess.CompletedProcess(command, 0, stdout="testing\n", stderr="")

    description = "A" * 150 + " CRITICAL ROUTING BOUNDARY"
    monkeypatch.setattr(trigger_scorer.subprocess, "run", run)

    assert trigger_scorer.ask_model({"testing": description}, "write a test") == ["testing"]
    assert "CRITICAL ROUTING BOUNDARY" in captured["prompt"]


def test_judge_retries_invalid_protocol_output(monkeypatch):
    attempts = iter(
        [
            subprocess.CompletedProcess([], 0, stdout="I recommend testing.\n", stderr=""),
            subprocess.CompletedProcess([], 0, stdout="testing\n", stderr=""),
        ]
    )
    monkeypatch.setattr(trigger_scorer.subprocess, "run", lambda *_args, **_kwargs: next(attempts))

    assert trigger_scorer.ask_model({"testing": "Test Elixir code"}, "write a test") == ["testing"]


def test_judge_retries_cli_start_failure(monkeypatch):
    attempts = iter(
        [
            OSError("temporarily unavailable"),
            subprocess.CompletedProcess([], 0, stdout="testing\n", stderr=""),
        ]
    )

    def run(*_args, **_kwargs):
        result = next(attempts)
        if isinstance(result, OSError):
            raise result
        return result

    monkeypatch.setattr(trigger_scorer.subprocess, "run", run)

    assert trigger_scorer.ask_model({"testing": "Test Elixir code"}, "write a test") == ["testing"]


def test_all_cli_rejects_incomplete_fixture_set_before_scoring(tmp_path, monkeypatch):
    (tmp_path / "one.json").write_text(json.dumps({"should_trigger": ["one"], "should_not_trigger": ["not one"]}))
    monkeypatch.setattr(sys, "argv", ["trigger_scorer", "--all", "--summary"])
    monkeypatch.setattr(trigger_scorer, "TRIGGERS_DIR", str(tmp_path))
    monkeypatch.setattr(trigger_scorer, "load_all_descriptions", lambda: {"one": "One", "two": "Two"})
    monkeypatch.setattr(
        trigger_scorer,
        "score_skill_triggers",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("paid scoring started before preflight")),
    )

    assert trigger_scorer.main() == 1


def test_summary_run_persists_completed_aggregate(tmp_path, monkeypatch):
    triggers_dir = tmp_path / "triggers"
    triggers_dir.mkdir()
    (triggers_dir / "demo.json").write_text(
        json.dumps({"should_trigger": ["demo"], "should_not_trigger": ["not demo"]})
    )
    aggregate_path = tmp_path / "aggregate.json"
    monkeypatch.setattr(sys, "argv", ["trigger_scorer", "--all", "--summary"])
    monkeypatch.setattr(trigger_scorer, "TRIGGERS_DIR", str(triggers_dir))
    monkeypatch.setattr(trigger_scorer, "load_all_descriptions", lambda: {"demo": "Demo"})
    monkeypatch.setattr(trigger_scorer, "aggregate_path_for_model", lambda _model: str(aggregate_path))
    monkeypatch.setattr(
        trigger_scorer,
        "score_skill_triggers",
        lambda *_args, **_kwargs: {"accuracy": 1.0, "precision": 1.0, "recall": 1.0},
    )

    assert trigger_scorer.main() == 0
    assert json.loads(aggregate_path.read_text())["skills_tested"] == 1


def test_failed_skill_run_preserves_previous_cache(tmp_path, monkeypatch):
    previous = {"accuracy": 1.0, "marker": "previous"}
    cache_path = tmp_path / "testing.json"
    cache_path.write_text(json.dumps(previous))
    monkeypatch.setattr(trigger_scorer, "RESULTS_DIR", str(tmp_path))
    monkeypatch.setattr(
        trigger_scorer,
        "ask_model",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(trigger_scorer.JudgeInvocationError("failed")),
    )

    try:
        trigger_scorer.score_skill_triggers(
            "testing",
            {"should_trigger": ["write a test"], "should_not_trigger": ["fix app code"]},
            {"testing": "Test Elixir code"},
        )
    except trigger_scorer.JudgeInvocationError:
        pass
    else:
        raise AssertionError("judge failure did not abort scoring")

    assert json.loads(cache_path.read_text()) == previous
    assert sorted(os.listdir(tmp_path)) == ["testing.json"]
