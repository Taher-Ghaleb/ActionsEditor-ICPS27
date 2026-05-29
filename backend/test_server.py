"""
Unit tests for the stateless AI proxy helpers in server.py.

These test the pure request-building / response-parsing functions
directly — no network, no server process, no database. Run with:

    python3 -m unittest backend/test_server.py -v

(from the repository root).
"""
import json
import unittest

from server import build_forward_request, extract_reply_text, ProxyValidationError


class BuildForwardRequestTests(unittest.TestCase):
    def test_valid_https_payload(self):
        # INPUT: a well-formed payload targeting a real https endpoint
        # EXPECTED: (url, headers, body) built correctly, key in the
        # Authorization header (not logged, not stored)
        url, headers, body = build_forward_request({
            "baseUrl": "https://api.openai.com/v1",
            "apiKey": "sk-test123",
            "model": "gpt-4o-mini",
            "messages": [{"role": "user", "content": "hi"}],
        })
        self.assertEqual(url, "https://api.openai.com/v1/chat/completions")
        self.assertEqual(headers["Authorization"], "Bearer sk-test123")
        self.assertEqual(json.loads(body)["model"], "gpt-4o-mini")

    def test_local_http_endpoint_is_allowed(self):
        # INPUT: a local self-hosted OpenAI-compatible server
        # EXPECTED: allowed (no exception) — this is the documented
        # "point it at your own local server" use case
        url, _, _ = build_forward_request({
            "baseUrl": "http://127.0.0.1:1234/v1",
            "apiKey": "anything",
            "model": "local-model",
            "messages": [{"role": "user", "content": "hi"}],
        })
        self.assertTrue(url.startswith("http://127.0.0.1:1234"))

    def test_arbitrary_http_endpoint_is_rejected(self):
        # INPUT: a non-https, non-local baseUrl
        # EXPECTED: ProxyValidationError (guards against the proxy
        # being used to reach arbitrary internal network hosts)
        with self.assertRaises(ProxyValidationError):
            build_forward_request({
                "baseUrl": "http://internal.example.com",
                "apiKey": "x",
                "model": "m",
                "messages": [{"role": "user", "content": "hi"}],
            })

    def test_missing_api_key_is_rejected(self):
        # INPUT: no apiKey field
        # EXPECTED: ProxyValidationError
        with self.assertRaises(ProxyValidationError):
            build_forward_request({
                "baseUrl": "https://api.openai.com/v1",
                "model": "gpt-4o-mini",
                "messages": [{"role": "user", "content": "hi"}],
            })

    def test_missing_messages_is_rejected(self):
        # INPUT: empty messages list
        # EXPECTED: ProxyValidationError
        with self.assertRaises(ProxyValidationError):
            build_forward_request({
                "baseUrl": "https://api.openai.com/v1",
                "apiKey": "sk-test",
                "model": "gpt-4o-mini",
                "messages": [],
            })


class ExtractReplyTextTests(unittest.TestCase):
    def test_valid_response(self):
        # INPUT: a well-formed OpenAI-style chat completion response
        # EXPECTED: the assistant's text is extracted
        text = extract_reply_text({
            "choices": [{"message": {"role": "assistant", "content": "Hello there"}}]
        })
        self.assertEqual(text, "Hello there")

    def test_no_choices_raises(self):
        # INPUT: a response with an empty choices list
        # EXPECTED: ProxyValidationError
        with self.assertRaises(ProxyValidationError):
            extract_reply_text({"choices": []})

    def test_empty_content_raises(self):
        # INPUT: a choice with empty message content
        # EXPECTED: ProxyValidationError
        with self.assertRaises(ProxyValidationError):
            extract_reply_text({"choices": [{"message": {"content": ""}}]})


if __name__ == "__main__":
    unittest.main()
