//! Prints the `/api/*` OpenAPI document. `just openapi-gen` writes it to `openapi/openapi.json`.

fn main() -> Result<(), serde_json::Error> {
    print!("{}", omnibus::backend::openapi::spec_json()?);
    Ok(())
}
