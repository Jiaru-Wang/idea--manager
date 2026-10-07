import json
import os
import tempfile
from pathlib import Path

handle = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
handle.close()
os.environ["IDEAMINER_DB"] = handle.name
os.environ.pop("OPENAI_API_KEY", None)
os.environ.pop("DEEPSEEK_API_KEY", None)
os.environ.pop("MINIMAX_API_KEY", None)
os.environ.pop("IDEAMINER_AGENT_PROVIDER", None)
os.environ.pop("IDEAMINER_AGENT_API_KEY", None)
os.environ.pop("IDEAMINER_AGENT_BASE_URL", None)

from fastapi.testclient import TestClient
from backend.app.database import db
from backend.app.main import _agent_context, app
from backend.app.schemas import AgentRunRequest
from backend.app.mcp_server import (
    copy_idea as mcp_copy_idea,
    create_codex_checkpoint as mcp_create_codex_checkpoint,
    create_idea as mcp_create_idea,
    create_project as mcp_create_project,
    get_idea as mcp_get_idea,
    move_idea as mcp_move_idea,
    search_ideas as mcp_search_ideas,
    update_idea as mcp_update_idea,
)


def test_deepseek_responses_provider(monkeypatch):
    captured = {}

    class FakeResponse:
        status_code = 200
        text = ""

        @staticmethod
        def json():
            return {"output": [{"type": "function_call", "name": "submit_research_result", "arguments": json.dumps({"answer": "# Refined agent idea\n\nDeveloped content", "proposals": []})}]}

    class FakeClient:
        def __init__(self, **_):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def post(self, url, headers, json):
            captured.update({"url": url, "headers": headers, "body": json})
            return FakeResponse()

    monkeypatch.setattr("backend.app.main.httpx.AsyncClient", FakeClient)
    with TestClient(app) as client:
        client.post("/api/agent/config", json={"provider": "deepseek", "api_key": "deepseek-test-key", "model": "deepseek-v4-flash"})
        parent = client.post("/api/ideas", json={"title": "Original agent idea", "content": "Original working content", "raw_text": "Immutable capture", "tags": ["agent-save"]}).json()
        result = client.post("/api/agent/runs", json={"prompt": "Elaborate", "mode": "elaborate", "scope_type": "all", "idea_id": parent["id"], "web_search": True})
        assert result.status_code == 200
        assert result.json()["provider"] == "deepseek"
        assert captured["url"] == "https://api.deepseek.com/responses"
        assert captured["body"]["reasoning"] == {"effort": "none"}
        assert captured["body"]["tools"][0] == {"type": "web_search"}
        assert "Never expose a raw reference" in captured["body"]["instructions"]
        assert captured["headers"]["Authorization"] == "Bearer deepseek-test-key"
        child_save = client.post(f"/api/agent/runs/{result.json()['id']}/save", json={"action": "create_child"})
        assert child_save.status_code == 200
        child = child_save.json()["idea"]
        assert child["title"] == "Refined agent idea"
        assert child["content"] == "Developed content"
        assert child["tags"] == ["agent-save"]
        assert child["project_id"] == parent["project_id"]
        assert client.post(f"/api/agent/runs/{result.json()['id']}/save", json={"action": "update_original"}).status_code == 409
        relation = next(item for item in client.get("/api/relations").json() if item["id"] == child_save.json()["relation_id"])
        assert (relation["source_id"], relation["target_id"], relation["relation_type"]) == (parent["id"], child["id"], "develops-into")

        update_run = client.post("/api/agent/runs", json={"prompt": "Elaborate again", "mode": "elaborate", "scope_type": "all", "idea_id": parent["id"]}).json()
        updated = client.post(f"/api/agent/runs/{update_run['id']}/save", json={"action": "update_original"})
        assert updated.status_code == 200
        refreshed_parent = client.get(f"/api/ideas/{parent['id']}").json()
        assert refreshed_parent["title"] == "Refined agent idea"
        assert refreshed_parent["content"] == "Developed content"
        assert refreshed_parent["raw_text"] == "Immutable capture"
        client.delete(f"/api/ideas/{child['id']}", params={"permanent": True})
        client.delete(f"/api/ideas/{parent['id']}", params={"permanent": True})
        client.delete("/api/agent/config")


def test_minimax_chat_completions_provider(monkeypatch):
    captured = {}

    class FakeResponse:
        status_code = 200
        text = ""

        @staticmethod
        def json():
            return {
                "choices": [{
                    "message": {
                        "content": json.dumps({
                            "answer": "# MiniMax synthesis\n\nA structured result.",
                            "proposals": [],
                        })
                    }
                }]
            }

    class FakeClient:
        def __init__(self, **_):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def post(self, url, headers, json):
            captured.update({"url": url, "headers": headers, "body": json})
            return FakeResponse()

    monkeypatch.setattr("backend.app.main.httpx.AsyncClient", FakeClient)
    with TestClient(app) as client:
        configured = client.post("/api/agent/config", json={
            "provider": "minimax",
            "api_key": "minimax-test-key",
            "model": "MiniMax-M2.7",
            "remember_api_key": False,
        })
        assert configured.status_code == 200
        result = client.post("/api/agent/runs", json={
            "prompt": "Analyze this paper",
            "mode": "synthesize",
            "scope_type": "all",
        })
        assert result.status_code == 200
        assert result.json()["provider"] == "minimax"
        assert result.json()["answer"].startswith("# MiniMax synthesis")
        assert captured["url"] == "https://api.minimaxi.com/v1/chat/completions"
        assert captured["headers"]["Authorization"] == "Bearer minimax-test-key"
        assert captured["body"]["model"] == "MiniMax-M2.7"
        assert captured["body"]["messages"][0]["role"] == "system"
        assert "minimax-test-key" not in str(result.json())
        client.delete("/api/agent/config/minimax")


def test_paper_discovery_merges_official_metadata_sources(monkeypatch):
    openalex = {
        "results": [{
            "id": "https://openalex.org/W1",
            "title": "Robust cross-subject EEG emotion recognition",
            "abstract_inverted_index": {"A": [0], "robust": [1], "method": [2]},
            "publication_date": "2025-06-01",
            "publication_year": 2025,
            "primary_location": {"source": {"display_name": "Nature Neuroscience"}, "landing_page_url": "https://example.org/paper"},
            "authorships": [{"author": {"display_name": "Jia Researcher"}}],
            "doi": "https://doi.org/10.1000/eeg.1",
            "cited_by_count": 60,
            "open_access": {"is_oa": True},
        }]
    }
    crossref = {
        "message": {"items": [{
            "DOI": "10.1000/eeg.1",
            "title": ["Robust cross-subject EEG emotion recognition"],
            "abstract": "<jats:p>A longer structured abstract for direct analysis.</jats:p>",
            "published-online": {"date-parts": [[2025, 6, 1]]},
            "author": [{"given": "Jia", "family": "Researcher"}],
            "container-title": ["Nature Neuroscience"],
            "URL": "https://doi.org/10.1000/eeg.1",
            "is-referenced-by-count": 55,
            "license": [{"URL": "https://creativecommons.org/licenses/by/4.0/"}],
        }]}
    }

    class FakeResponse:
        def __init__(self, payload):
            self.payload = payload
            self.content = b"{}"

        def raise_for_status(self):
            return None

        def json(self):
            return self.payload

    class FakeClient:
        def __init__(self, **_):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def get(self, url, params, headers):
            assert params
            assert headers["User-Agent"].startswith("IdeaMiner/")
            return FakeResponse(openalex if "openalex" in url else crossref)

    monkeypatch.setattr("backend.app.main.httpx.AsyncClient", FakeClient)
    with TestClient(app) as client:
        response = client.get("/api/papers/discover", params={
            "q": "EEG emotion recognition",
            "venues": "Nature Neuroscience",
            "from_year": 2024,
        })
        assert response.status_code == 200
        payload = response.json()
        assert payload["sources"] == ["OpenAlex", "Crossref"]
        assert len(payload["papers"]) == 1
        paper = payload["papers"][0]
        assert paper["doi"] == "10.1000/eeg.1"
        assert paper["metadata_sources"] == ["Crossref", "OpenAlex"]
        assert paper["abstract"] == "A longer structured abstract for direct analysis."
        assert "目标期刊/会议匹配" in paper["match_reasons"]


def test_paper_discovery_falls_back_when_venue_metadata_does_not_match(monkeypatch):
    openalex = {
        "results": [{
            "id": "https://openalex.org/W2",
            "title": "PATCHCODE: Discrete Latent Predictive Learning for EEG Foundation Model",
            "abstract_inverted_index": {"EEG": [0], "foundation": [1], "model": [2]},
            "publication_date": "2026-07-01",
            "publication_year": 2026,
            "primary_location": {"source": {"display_name": "PMLR"}},
            "authorships": [{"author": {"display_name": "Kieren Yu"}}],
            "doi": "",
            "cited_by_count": 0,
            "open_access": {"is_oa": True},
        }]
    }
    crossref = {"message": {"items": []}}

    class FakeResponse:
        def __init__(self, payload):
            self.payload = payload
            self.content = b"{}"

        def raise_for_status(self):
            return None

        def json(self):
            return self.payload

    class FakeClient:
        def __init__(self, **_):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def get(self, url, params, headers):
            return FakeResponse(openalex if "openalex" in url else crossref)

    monkeypatch.setattr("backend.app.main.httpx.AsyncClient", FakeClient)
    with TestClient(app) as client:
        response = client.get("/api/papers/discover", params={
            "q": "PATCHCODE EEG foundation model",
            "venues": "Proceedings of Machine Learning Research",
            "from_year": 2026,
        })
        assert response.status_code == 200
        payload = response.json()
        assert [paper["title"] for paper in payload["papers"]] == [openalex["results"][0]["title"]]
        assert "目标期刊/会议精确筛选未命中" in payload["warnings"][0]
        assert "目标期刊/会议匹配" not in payload["papers"][0]["match_reasons"]


def test_paper_context_uses_explicit_corresponding_author_metadata(monkeypatch):
    paper = {
        "results": [{
            "id": "https://openalex.org/W1",
            "title": "A cross-disciplinary mechanism paper",
            "corresponding_author_ids": ["https://openalex.org/A1"],
            "authorships": [
                {
                    "is_corresponding": True,
                    "author": {"id": "https://openalex.org/A1", "display_name": "Lead Corresponding", "orcid": "https://orcid.org/0000-0001"},
                    "institutions": [{"display_name": "Example University"}],
                },
                {
                    "is_corresponding": False,
                    "author": {"id": "https://openalex.org/A2", "display_name": "Last Author"},
                    "institutions": [],
                },
            ],
        }]
    }
    recent = {
        "results": [
            paper["results"][0],
            {
                "id": "https://openalex.org/W2",
                "title": "Earlier mechanism study",
                "publication_year": 2025,
                "primary_location": {"source": {"display_name": "Example Journal"}},
                "doi": "https://doi.org/10.1000/earlier",
                "cited_by_count": 12,
            },
        ]
    }

    class FakeResponse:
        def __init__(self, payload):
            self.payload = payload
            self.content = b"{}"

        def raise_for_status(self):
            return None

        def json(self):
            return self.payload

    class FakeClient:
        def __init__(self, **_):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def get(self, _url, params, headers):
            assert headers["User-Agent"].startswith("IdeaMiner/")
            return FakeResponse(recent if "authorships.author.id" in params.get("filter", "") else paper)

    monkeypatch.setattr("backend.app.main.httpx.AsyncClient", FakeClient)
    with TestClient(app) as client:
        response = client.get("/api/papers/context", params={
            "title": "A cross-disciplinary mechanism paper",
            "locator": "https://doi.org/10.1000/example",
        })
        assert response.status_code == 200
        payload = response.json()
        assert [author["name"] for author in payload["corresponding_authors"]] == ["Lead Corresponding"]
        assert payload["corresponding_authors"][0]["institution"] == "Example University"
        assert [work["title"] for work in payload["recent_works"]] == ["Earlier mechanism study"]
        assert "is_corresponding" in payload["evidence_note"]


def test_anthropic_messages_provider(monkeypatch):
    captured = {}

    class FakeResponse:
        status_code = 200
        text = ""

        @staticmethod
        def json():
            return {"content": [{"type": "tool_use", "name": "submit_research_result", "input": {"answer": "# Claude synthesis\n\nA structured result.", "proposals": []}}]}

    class FakeClient:
        def __init__(self, **_): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *_): pass
        async def post(self, url, headers, json):
            captured.update({"url": url, "headers": headers, "body": json})
            return FakeResponse()

    monkeypatch.setattr("backend.app.main.httpx.AsyncClient", FakeClient)
    with TestClient(app) as client:
        configured = client.post("/api/agent/config", json={
            "provider": "anthropic", "api_key": "anthropic-test-key", "model": "claude-sonnet-5",
            "reasoning_effort": "high", "remember_api_key": False,
        })
        assert configured.status_code == 200
        result = client.post("/api/agent/runs", json={"prompt": "Synthesize", "mode": "synthesize", "scope_type": "all"})
        assert result.status_code == 200
        assert result.json()["provider"] == "anthropic"
        assert captured["url"] == "https://api.anthropic.com/v1/messages"
        assert captured["headers"]["x-api-key"] == "anthropic-test-key"
        assert captured["body"]["thinking"] == {"type": "adaptive"}
        assert captured["body"]["output_config"] == {"effort": "high"}
        assert captured["body"]["tools"][0]["input_schema"]["required"] == ["answer", "proposals"]
        client.delete("/api/agent/config/anthropic")


def test_multiple_agent_profiles_switch_without_retyping_keys():
    with TestClient(app) as client:
        assert client.post("/api/agent/config", json={
            "provider": "openai", "api_key": "openai-test-key", "model": "gpt-5.6-terra",
            "reasoning_effort": "low", "remember_api_key": False,
        }).status_code == 200
        assert client.post("/api/agent/config", json={
            "provider": "local", "api_key": "", "model": "local-research-model",
            "base_url": "http://127.0.0.1:11434/v1", "reasoning_effort": "none",
        }).status_code == 200
        switched = client.post("/api/agent/activate/openai").json()
        assert switched["provider"] == "openai"
        assert switched["configured"] is True
        assert switched["default_model"] == "gpt-5.6-terra"
        profiles = {item["id"]: item for item in switched["providers"]}
        assert profiles["openai"]["configured"] is True
        assert profiles["local"]["configured"] is True
        assert profiles["openai"]["reasoning_effort"] == "low"
        client.delete("/api/agent/config/openai")
        client.delete("/api/agent/config/local")


def test_core_workflow():
    with TestClient(app) as client:
        agent_status = client.get("/api/agent/status").json()
        assert agent_status["configured"] is False
        assert "raw captures" in agent_status["privacy"]
        connected = client.post("/api/agent/config", json={"provider": "deepseek", "api_key": "sk-test-session-key", "model": "deepseek-test"}).json()
        assert connected["configured"] is True
        assert connected["provider"] == "deepseek"
        assert connected["provider_label"] == "DeepSeek"
        assert connected["base_url"] == "https://api.deepseek.com"
        assert connected["web_search_supported"] is True
        assert connected["configuration_source"] == "session"
        assert "sk-test-session-key" not in str(connected)
        disconnected = client.delete("/api/agent/config").json()
        assert disconnected["configured"] is False
        invalid_custom = client.post("/api/agent/config", json={"provider": "custom", "model": "local-model", "base_url": "file:///tmp/model"})
        assert invalid_custom.status_code == 400
        disposable = client.post("/api/ideas", json={"title": "Disposable", "tags": ["only-on-disposable"]}).json()
        assert any(tag["name"] == "only-on-disposable" for tag in client.get("/api/tags").json())
        assert client.delete(f"/api/ideas/{disposable['id']}", params={"permanent": True}).json()["action"] == "deleted"
        assert all(tag["name"] != "only-on-disposable" for tag in client.get("/api/tags").json())
        with db() as connection:
            assert connection.execute("SELECT COUNT(*) count FROM tags WHERE name='only-on-disposable'").fetchone()["count"] == 0
        recyclable = client.post("/api/ideas", json={"title": "Recyclable", "tags": ["recycle-only"]}).json()
        client.delete(f"/api/ideas/{recyclable['id']}")
        recycle_id = next(item["id"] for item in client.get("/api/projects").json() if item["system_key"] == "recycle")
        assert all(tag["name"] != "recycle-only" for tag in client.get("/api/tags").json())
        assert any(tag["name"] == "recycle-only" for tag in client.get("/api/tags", params={"project_id": recycle_id}).json())
        client.delete(f"/api/ideas/{recyclable['id']}")
        one = client.post("/api/ideas", json={"title": "Graph memory", "content": "Use graphs for research notes", "raw_text": "messy original", "tags": ["Graphs", "memory"]})
        assert one.status_code == 201
        idea = one.json()
        two = client.post("/api/ideas", json={"title": "Memory retrieval", "content": "Graph based retrieval", "tags": ["memory"]}).json()
        assert len(client.get("/api/ideas", params={"q": "graph"}).json()) == 2
        assert len(client.get("/api/ideas", params={"tag": "memory"}).json()) == 2
        updated = client.put(f"/api/ideas/{idea['id']}", json={"title": "Graph memory revised", "content": f"Build with Idea #{two['id']}", "status": "promising", "tags": ["memory"]}).json()
        assert updated["raw_text"] == "messy original"
        assert "develops-into" in client.get("/api/relation-types").json()
        relation = client.post("/api/relations", json={"source_id": idea["id"], "target_id": two["id"], "relation_type": "builds-on"})
        assert relation.status_code == 201
        lineage = client.post("/api/relations", json={"source_id": idea["id"], "target_id": two["id"], "relation_type": "develops-into"})
        assert lineage.status_code == 201
        cycle = client.post("/api/relations", json={"source_id": two["id"], "target_id": idea["id"], "relation_type": "develops-into"})
        assert cycle.status_code == 409
        assert "cycle" in cycle.json()["detail"]
        assert client.get(f"/api/ideas/{idea['id']}/suggestions").json()[0]["id"] == two["id"]
        markdown_export = client.get("/api/export/markdown").text
        assert "Graph memory revised" in markdown_export
        assert f"[Memory retrieval](#idea-{two['id']})" in markdown_export
        assert len(client.get("/api/export/json").json()["relations"]) == 2

        group = client.post("/api/project-groups", json={"name": "Active research"}).json()
        project = client.post("/api/projects", json={"name": "Graph studies", "description": "Focused work", "group_id": group["id"]}).json()
        with db() as connection:
            run_id = connection.execute(
                """INSERT INTO agent_runs(model, prompt, mode, scope_type, context_json, response_text, status)
                   VALUES ('test-model', 'Develop this', 'elaborate', 'project', '{}', 'A useful direction', 'completed')"""
            ).lastrowid
            proposal_id = connection.execute(
                """INSERT INTO agent_proposals(run_id, action_type, title, rationale, payload_json)
                   VALUES (?, 'create_idea', 'Agent draft', 'Worth testing', ?)""",
                (run_id, __import__('json').dumps({"idea_title": "Agent-created lead", "content": "A proposed experiment", "status": "exploring", "tags": ["agent"], "project_id": project["id"]})),
            ).lastrowid
        applied = client.post(f"/api/agent/proposals/{proposal_id}", json={"action": "apply"})
        assert applied.status_code == 200
        agent_idea = client.get(f"/api/ideas/{applied.json()['created_idea_id']}").json()
        assert agent_idea["raw_text"].startswith("AI-generated proposal")
        assert agent_idea["project_id"] == project["id"]
        client.delete(f"/api/ideas/{agent_idea['id']}", params={"permanent": True})
        copied = client.post(f"/api/ideas/{idea['id']}/copy", json={"project_id": project["id"]})
        assert copied.status_code == 201
        assert copied.json()["project_id"] == project["id"]
        assert [item["id"] for item in client.get("/api/ideas", params={"group_id": group["id"]}).json()] == [copied.json()["id"]]

        recycled = client.delete(f"/api/ideas/{copied.json()['id']}")
        assert recycled.json()["action"] == "recycled"
        recycle = next(item for item in client.get("/api/projects").json() if item["system_key"] == "recycle")
        assert client.get("/api/ideas", params={"project_id": recycle["id"]}).json()[0]["id"] == copied.json()["id"]
        assert client.delete(f"/api/ideas/{copied.json()['id']}").json()["action"] == "deleted"

        client.post(f"/api/ideas/{idea['id']}/move", json={"project_id": project["id"]})
        client.post(f"/api/ideas/{two['id']}/move", json={"project_id": project["id"]})
        cleared = client.delete(f"/api/projects/{project['id']}/ideas").json()
        assert cleared == {"action": "recycled", "count": 2}
        emptied = client.delete(f"/api/projects/{recycle['id']}/ideas").json()
        assert emptied == {"action": "deleted", "count": 2}

        imported_one = client.post("/api/ideas", json={"title": "Portable one", "content": "First", "raw_text": "original one", "project_id": project["id"], "tags": ["portable"]}).json()
        imported_two = client.post("/api/ideas", json={"title": "Portable two", "content": "Second", "raw_text": "original two", "project_id": project["id"], "tags": ["portable"]}).json()
        client.post("/api/relations", json={"source_id": imported_one["id"], "target_id": imported_two["id"], "relation_type": "related-to"})
        portable = client.get("/api/export/json").json()
        preview = client.post("/api/import/preview", json={"data": portable})
        assert preview.status_code == 200
        assert preview.json()["duplicate_topics"] == 2
        assert "Graph studies" in preview.json()["project_conflicts"]

        skipped = client.post("/api/import/json", json={"data": portable, "duplicate_strategy": "skip", "project_strategy": "merge"})
        assert skipped.status_code == 200
        assert skipped.json()["ideas_skipped"] == 2
        copied_import = client.post("/api/import/json", json={"data": portable, "duplicate_strategy": "copy", "project_strategy": "rename"})
        assert copied_import.status_code == 200
        assert copied_import.json()["ideas_created"] == 2
        assert copied_import.json()["relations_created"] == 1

        groups_before = len(client.get("/api/project-groups").json())
        broken = {"version": 2, "project_groups": [{"id": 99, "name": "Must roll back"}], "projects": [{"id": "bad", "name": "Broken"}], "ideas": [], "relations": []}
        assert client.post("/api/import/json", json={"data": broken}).status_code == 400
        assert len(client.get("/api/project-groups").json()) == groups_before


def test_weekly_review_semantic_discovery_and_codex_checkpoint():
    with TestClient(app) as client:
        project = client.post("/api/projects", json={"name": "Review study", "description": "", "group_id": None, "workspace_mode": "library", "workspace_path": ""}).json()
        parent = client.post("/api/ideas", json={"title": "EEG temporal scale prediction", "content": "EEG neural temporal prediction multiscale signal transition repeated EEG neural temporal prediction", "raw_text": "parent raw", "project_id": project["id"], "tags": ["eeg"]}).json()
        peer = client.post("/api/ideas", json={"title": "Multiscale neural EEG forecast", "content": "EEG neural temporal prediction multiscale signal transition repeated EEG neural temporal prediction", "raw_text": "peer raw", "project_id": project["id"], "tags": ["forecast"]}).json()
        linked = client.post("/api/ideas", json={"title": "Directly linked EEG concept", "content": "EEG neural temporal prediction multiscale signal", "raw_text": "linked raw", "project_id": project["id"]}).json()
        assert client.post("/api/relations", json={"source_id": parent["id"], "target_id": linked["id"], "relation_type": "builds-on", "note": "already related"}).status_code == 201
        rebuilt = client.post("/api/semantic/rebuild")
        assert rebuilt.status_code == 200 and rebuilt.json()["indexed_ideas"] >= 3
        suggestions = client.get(f"/api/ideas/{parent['id']}/semantic-suggestions").json()
        assert any(item["id"] == peer["id"] for item in suggestions)
        assert not any(item["id"] == linked["id"] for item in suggestions)

        checkpoint = client.post("/api/codex/checkpoints", json={"project_id": project["id"], "task_title": "EEG analysis task", "summary": "Distilled an experiment direction.", "proposals": [{"title": "Test cross-scale EEG transition", "content": "Compare forecasting across temporal scales.", "tags": ["eeg", "experiment"], "parent_id": parent["id"]}]}).json()
        assert len(checkpoint["proposals"]) == 1
        review = client.get("/api/review", params={"project_id": project["id"]}).json()
        assert review["summary"]["pending_proposals"] == 1
        proposal_id = checkpoint["proposals"][0]["id"]
        applied = client.post(f"/api/agent/proposals/{proposal_id}", json={"action": "apply"}).json()
        child = client.get(f"/api/ideas/{applied['created_idea_id']}").json()
        assert child["title"] == "Test cross-scale EEG transition"
        assert child["project_id"] == project["id"]
        relation = next(item for item in client.get("/api/relations").json() if item["id"] == applied["created_relation_id"])
        assert (relation["source_id"], relation["target_id"], relation["relation_type"]) == (parent["id"], child["id"], "develops-into")
        checkpoint_mcp = mcp_create_codex_checkpoint("MCP review queue", project["name"], [{"title": "Queued only", "content": "No immediate write"}], "MCP task", "checkpoint-idempotent")
        assert checkpoint_mcp["proposals"][0]["status"] == "pending"


def test_dream_combines_cross_project_sources_with_dreams_tag(monkeypatch):
    captured = {}

    class FakeResponse:
        status_code = 200
        text = ""

        @staticmethod
        def json():
            return {"output": [{"type": "function_call", "name": "submit_research_result", "arguments": json.dumps({"answer": "# Dream synthesis\n\nA bridge between both sources.", "proposals": [{"action": "create_idea", "title": "Cross-project prediction bridge", "rationale": "Combines both source mechanisms.", "idea_id": 0, "project_id": 0, "idea_title": "Cross-project prediction bridge", "content": "Test a unified cross-project prediction mechanism.", "status": "exploring", "tags": ["hypothesis"], "source_id": 0, "target_id": 0, "relation_type": "", "note": ""}]})}]}

    class FakeClient:
        def __init__(self, **_): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *_): pass
        async def post(self, url, headers, json):
            captured.update({"url": url, "body": json})
            return FakeResponse()

    monkeypatch.setattr("backend.app.main.httpx.AsyncClient", FakeClient)
    with TestClient(app) as client:
        first_project = client.post("/api/projects", json={"name": "Dream source A"}).json()
        second_project = client.post("/api/projects", json={"name": "Dream source B"}).json()
        destination = client.post("/api/projects", json={"name": "Dream destination"}).json()
        first = client.post("/api/ideas", json={"title": "Oscillatory prediction", "content": "First source note", "raw_text": "private original one", "project_id": first_project["id"]}).json()
        second = client.post("/api/ideas", json={"title": "Semantic aggregation", "content": "Second source note", "raw_text": "private original two", "project_id": second_project["id"]}).json()
        client.post("/api/agent/config", json={"provider": "deepseek", "api_key": "dream-test-key", "model": "dream-model"})
        response = client.post("/api/dreams", json={"idea_ids": [first["id"], second["id"]], "project_id": destination["id"], "prompt": "Find an unexpected experimental bridge."})
        assert response.status_code == 200
        dream = response.json()
        assert dream["proposals"][0]["payload"]["tags"][0] == "dreams"
        assert dream["proposals"][0]["payload"]["source_ids"] == [first["id"], second["id"]]
        assert "private original" not in captured["body"]["input"]
        applied = client.post(f"/api/agent/proposals/{dream['proposals'][0]['id']}", json={"action": "apply"}).json()
        born = client.get(f"/api/ideas/{applied['created_idea_id']}").json()
        assert born["project_id"] == destination["id"]
        assert born["tags"][0] == "dreams"
        relations = client.get("/api/relations").json()
        born_links = [item for item in relations if item["target_id"] == born["id"] and item["relation_type"] == "inspired-by"]
        assert {item["source_id"] for item in born_links} == {first["id"], second["id"]}
        client.delete("/api/agent/config")


def test_tag_management_and_bulk_updates():
    with TestClient(app) as client:
        first = client.post("/api/ideas", json={"title": "Tag manager one", "tags": ["legacy", "method"]}).json()
        second = client.post("/api/ideas", json={"title": "Tag manager two", "tags": ["legacy", "dataset"]}).json()
        settings = client.put("/api/tags/legacy/settings", json={"group_name": "Vocabulary", "is_hidden": True})
        assert settings.status_code == 200
        assert "legacy" not in {item["name"] for item in client.get("/api/tags").json()}
        managed = {item["name"]: item for item in client.get("/api/tags/manage").json()}
        assert managed["legacy"]["group_name"] == "Vocabulary" and managed["legacy"]["is_hidden"] == 1
        renamed = client.post("/api/tags/legacy/rename", json={"name": "foundation"})
        assert renamed.status_code == 200
        merged = client.post("/api/tags/dataset/merge", json={"target_name": "foundation"})
        assert merged.status_code == 200 and merged.json()["merged"] is True
        bulk = client.post("/api/tags/bulk", json={"idea_ids": [first["id"], second["id"]], "add_tags": ["review"], "remove_tags": ["method"]})
        assert bulk.status_code == 200 and bulk.json()["ideas_updated"] == 2
        first_tags = client.get(f"/api/ideas/{first['id']}").json()["tags"]
        second_tags = client.get(f"/api/ideas/{second['id']}").json()["tags"]
        assert "foundation" in first_tags and "review" in first_tags and "method" not in first_tags
        assert "foundation" in second_tags and "review" in second_tags
        client.put("/api/tags/foundation/settings", json={"group_name": "Vocabulary", "is_hidden": False})
        tag_map = client.get("/api/tags/map").json()
        mapped_nodes = {node["name"]: node for node in tag_map["nodes"]}
        assert mapped_nodes["foundation"]["group_name"] == "Vocabulary"
        assert any(
            {edge["source"], edge["target"]} == {"foundation", "review"} and edge["weight"] == 2
            for edge in tag_map["edges"]
        )


def test_project_workspaces_and_attachments():
    with tempfile.TemporaryDirectory() as directory, TestClient(app) as client:
        root = Path(directory)
        source = root / "notes.md"
        source.write_text("Local evidence for the research idea", encoding="utf-8")

        linked = client.post("/api/projects", json={
            "name": "Linked file study", "workspace_mode": "linked", "workspace_path": str(root),
        })
        assert linked.status_code == 201
        assert linked.json()["workspace_path"] == str(root.resolve())
        idea = client.post("/api/ideas", json={"title": "File-aware idea", "project_id": linked.json()["id"]}).json()
        attachment = client.post(f"/api/ideas/{idea['id']}/attachments", json={"path": str(source), "storage_mode": "linked"})
        assert attachment.status_code == 201
        assert attachment.json()["exists"] is True
        assert attachment.json()["content_hash"]
        assert client.get(f"/api/ideas/{idea['id']}").json()["attachments"][0]["display_name"] == "notes.md"
        assert client.get("/api/attachments", params={"idea_id": idea["id"]}).json()[0]["id"] == attachment.json()["id"]
        with db() as connection:
            context = _agent_context(connection, AgentRunRequest(prompt="Use this file", idea_id=idea["id"], attachment_ids=[attachment.json()["id"]]))
        assert context["files"][0]["path"] == str(source.resolve())
        assert client.delete(f"/api/ideas/{idea['id']}/attachments/{attachment.json()['id']}").status_code == 204
        assert source.exists(), "unlinking must never delete the external file"

        managed = client.post("/api/projects", json={
            "name": "Managed file study", "workspace_mode": "managed", "workspace_path": str(root),
        })
        assert managed.status_code == 201
        workspace = Path(managed.json()["workspace_path"])
        assert (workspace / ".ideaminer" / "project.json").is_file()
        managed_idea = client.post("/api/ideas", json={"title": "Managed-file idea", "project_id": managed.json()["id"]}).json()
        copied = client.post(f"/api/ideas/{managed_idea['id']}/attachments", json={"path": str(source), "storage_mode": "managed"})
        assert copied.status_code == 201
        assert copied.json()["storage_mode"] == "managed"
        assert Path(copied.json()["absolute_path"]).is_file()


def test_codex_mcp_bridge_and_external_revision():
    with TestClient(app) as client:
        before = client.get("/api/library-state").json()["revision"]
        project_result = mcp_create_project(
            name="Codex bridge study",
            description="Created through the local MCP bridge",
            idempotency_key="test-create-project",
        )
        project = project_result["project"]
        repeated_project = mcp_create_project(
            name="Codex bridge study",
            description="Created through the local MCP bridge",
            idempotency_key="test-create-project",
        )
        assert repeated_project["project"]["id"] == project["id"]

        parent_result = mcp_create_idea(
            title="MCP parent",
            content="Working interpretation",
            raw_text="verbatim parent capture",
            project=project["name"],
            tags=["mcp"],
            idempotency_key="test-create-parent",
        )
        parent = parent_result["idea"]
        child_result = mcp_create_idea(
            title="MCP descendant",
            content="A testable child direction",
            raw_text="verbatim child capture",
            parent_reference=f"[[idea:{parent['id']}]]",
            idempotency_key="test-create-child",
        )
        child = child_result["idea"]
        assert child["project_id"] == project["id"]
        assert child_result["relation"]["relation_type"] == "develops-into"
        assert mcp_get_idea(f"[[idea:{child['id']}]]")["idea"]["raw_text"] == "verbatim child capture"
        assert mcp_search_ideas(query="descendant", project=project["name"])["ideas"][0]["id"] == child["id"]

        updated = mcp_update_idea(
            reference=f"[[idea:{parent['id']}]]",
            expected_updated_at=parent["updated_at"],
            content="Revised through Codex",
            status="promising",
            idempotency_key="test-update-parent",
        )["idea"]
        assert updated["raw_text"] == "verbatim parent capture"
        assert updated["content"] == "Revised through Codex"
        try:
            mcp_update_idea(
                reference=f"[[idea:{parent['id']}]]",
                expected_updated_at=parent["updated_at"],
                content="Stale overwrite",
                idempotency_key="test-stale-update",
            )
            assert False, "a stale MCP update must be rejected"
        except ValueError as error:
            assert "changed after it was read" in str(error)

        random_chat = next(item for item in client.get("/api/projects").json() if item["system_key"] == "random_chat")
        moved = mcp_move_idea(f"[[idea:{child['id']}]]", random_chat["name"], "test-move-child")["idea"]
        assert moved["project_id"] == random_chat["id"]
        copied = mcp_copy_idea(f"[[idea:{child['id']}]]", project["name"], "test-copy-child")["idea"]
        assert copied["project_id"] == project["id"]

        after = client.get("/api/library-state").json()["revision"]
        assert after > before
        client.delete(f"/api/ideas/{copied['id']}", params={"permanent": True})
        client.delete(f"/api/ideas/{child['id']}", params={"permanent": True})
        client.delete(f"/api/ideas/{parent['id']}", params={"permanent": True})


def teardown_module():
    try:
        os.unlink(handle.name)
    except PermissionError:
        pass
