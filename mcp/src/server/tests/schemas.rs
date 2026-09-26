//! The advertised tool schemas across every family: each `outputSchema` must
//! have an object root, which rmcp no longer checks for us.

use super::offline_server;

#[test]
fn every_tool_advertises_an_object_rooted_output_schema() {
    // MCP 2025-06-18 requires it, and a strict client (Hermes) refuses the
    // whole server over one tool that returns a bare array or a nullable.
    let bad: Vec<String> = offline_server()
        .tool_router
        .list_all()
        .into_iter()
        .filter(|tool| {
            tool.output_schema
                .as_ref()
                .and_then(|schema| schema.get("type"))
                .and_then(|t| t.as_str())
                != Some("object")
        })
        .map(|tool| tool.name.to_string())
        .collect();
    assert!(
        bad.is_empty(),
        "missing or non-object outputSchema: {bad:?}"
    );
}
