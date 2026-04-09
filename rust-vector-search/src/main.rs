use axum::{
    extract::{State, Json},
    routing::{post, get},
    Router,
};
use fastembed::{TextEmbedding, InitOptions, EmbeddingModel};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::fs;
use std::path::Path;
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;
use std::sync::Mutex;

#[derive(Serialize, Deserialize)]
struct IconRecord {
    id: String,
    embedding: Vec<f32>,
}

struct AppState {
    embedder: Mutex<TextEmbedding>,
    index: Option<Vec<IconRecord>>,
}

#[derive(Deserialize)]
struct SearchRequest {
    query: String,
    limit: Option<usize>,
}

#[derive(Serialize, Deserialize)]
struct Match {
    icon_id: String,
    score: f32,
}

#[derive(Serialize, Deserialize)]
struct SearchResponse {
    embedding: Vec<f32>,
    fast_matches: Vec<Match>,
    snapshot_timestamp: u64,
}

#[derive(Serialize, Deserialize)]
struct EmbedResponse {
    embedding: Vec<f32>,
}

fn dot_product(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot = dot_product(a, b);
    let norm_a = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a == 0.0 || norm_b == 0.0 {
        0.0
    } else {
        dot / (norm_a * norm_b)
    }
}

async fn search_handler(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<SearchRequest>,
) -> axum::response::Json<SearchResponse> {
    // Generate embedding
    let embeddings = {
        let embedder = state.embedder.lock().unwrap();
        embedder.embed(vec![payload.query], None).unwrap()
    };
    let query_vector = &embeddings[0];

    let mut fast_matches = Vec::new();

    if let Some(index) = &state.index {
        let limit = payload.limit.unwrap_or(12);
        
        for record in index {
            let score = cosine_similarity(query_vector, &record.embedding);
            fast_matches.push(Match {
                icon_id: record.id.clone(),
                score,
            });
        }
        
        fast_matches.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());
        fast_matches.truncate(limit);
    }

    axum::response::Json(SearchResponse {
        embedding: query_vector.clone(),
        fast_matches,
        snapshot_timestamp: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64, // Real impl would use actual DB snapshot time
    })
}

async fn embed_handler(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<SearchRequest>,
) -> axum::response::Json<EmbedResponse> {
    let embeddings = {
        let embedder = state.embedder.lock().unwrap();
        embedder.embed(vec![payload.query], None).unwrap()
    };
    axum::response::Json(EmbedResponse {
        embedding: embeddings[0].clone(),
    })
}

async fn health() -> &'static str {
    "OK"
}

pub fn create_app(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/search", post(search_handler))
        .route("/embed", post(embed_handler))
        .route("/health", get(health))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

#[tokio::main]
async fn main() {
    println!("Initializing FastEmbed...");
    let mut options = InitOptions::new(EmbeddingModel::AllMiniLML6V2);
    options.show_download_progress = true;
    let embedder = TextEmbedding::try_new(options).unwrap();

    let mut index = None;
    if Path::new("icon_index.json").exists() {
        println!("Loading icon_index.json...");
        let data = fs::read_to_string("icon_index.json").unwrap();
        let records: Vec<IconRecord> = serde_json::from_str(&data).expect("Failed to parse index");
        println!("Loaded {} icons into memory.", records.len());
        index = Some(records);
    } else {
        println!("No icon_index.json found. Running in embed-only mode.");
    }

    let state = Arc::new(AppState { embedder: Mutex::new(embedder), index });
    let app = create_app(state);

    println!("Listening on 0.0.0.0:8080");
    let listener = TcpListener::bind("0.0.0.0:8080").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use http_body_util::BodyExt; 
    use tower::ServiceExt; 

    #[tokio::test]
    async fn test_embed_only() {
        let options = InitOptions::new(EmbeddingModel::AllMiniLML6V2);
        let embedder = TextEmbedding::try_new(options).unwrap();
        
        let state = Arc::new(AppState { embedder: Mutex::new(embedder), index: None });
        let app = create_app(state);

        let request = Request::builder()
            .uri("/search")
            .method("POST")
            .header("Content-Type", "application/json")
            .body(Body::from(r#"{"query": "apple", "limit": 2}"#))
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body = response.into_body().collect().await.unwrap().to_bytes();
        let res: SearchResponse = serde_json::from_slice(&body).unwrap();
        
        assert_eq!(res.embedding.len(), 384);
        assert_eq!(res.fast_matches.len(), 0);
    }

    #[tokio::test]
    async fn test_with_index() {
        let options = InitOptions::new(EmbeddingModel::AllMiniLML6V2);
        let embedder = TextEmbedding::try_new(options).unwrap();
        
        // Mock a single record
        let record = IconRecord {
            id: "apple_icon".to_string(),
            embedding: embedder.embed(vec!["apple".to_string()], None).unwrap()[0].clone(),
        };

        let state = Arc::new(AppState { embedder: Mutex::new(embedder), index: Some(vec![record]) });
        let app = create_app(state);

        let request = Request::builder()
            .uri("/search")
            .method("POST")
            .header("Content-Type", "application/json")
            .body(Body::from(r#"{"query": "apple", "limit": 2}"#))
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body = response.into_body().collect().await.unwrap().to_bytes();
        let res: SearchResponse = serde_json::from_slice(&body).unwrap();
        
        assert_eq!(res.fast_matches.len(), 1);
        assert_eq!(res.fast_matches[0].icon_id, "apple_icon");
        assert!(res.fast_matches[0].score > 0.99); // Should be very close to 1.0
    }
}
