use axum::{
    extract::Json,
    routing::post,
    Router,
};
use fastembed::{TextEmbedding, InitOptions, EmbeddingModel};
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, sync::Arc, time::Instant, fs};
use tower_http::cors::{Any, CorsLayer};
use tokio::sync::Mutex;

#[derive(Deserialize)]
struct SearchRequest {
    text: String,
}

#[derive(Serialize)]
struct SearchResponse {
    embed_time_ms: u128,
    search_time_ms: u128,
    results: Vec<IconDoc>,
}

#[derive(Deserialize, Serialize, Clone)]
struct IconDoc {
    id: String,
    ingredient_name: String,
    url: String,
    icon_id: String,
    #[serde(skip_serializing)]
    embedding: Vec<f32>,
}

struct AppState {
    model: Mutex<TextEmbedding>,
    db: Vec<IconDoc>,
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let mut dot = 0.0;
    let mut norm_a = 0.0;
    let mut norm_b = 0.0;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        norm_a += a[i] * a[i];
        norm_b += b[i] * b[i];
    }
    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    dot / (norm_a.sqrt() * norm_b.sqrt())
}

#[tokio::main]
async fn main() {
    println!("Loading DB from disk...");
    let file_content = fs::read_to_string("../public/icon_index_384.json")
        .expect("Failed to read icon_index_384.json (Did you run the dump script?)");
    let db: Vec<IconDoc> = serde_json::from_str(&file_content).unwrap();
    println!("Loaded {} documents into memory.", db.len());

    println!("Loading FastEmbed model...");
    let mut options = InitOptions::new(EmbeddingModel::AllMiniLML6V2);
    options.show_download_progress = true;
    let model = TextEmbedding::try_new(options).unwrap();

    let state = Arc::new(AppState { 
        model: Mutex::new(model), 
        db 
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/search", post(search_handler))
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], 8080));
    println!("Rust In-Memory Engine listening on http://{}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn search_handler(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    Json(payload): Json<SearchRequest>,
) -> Json<SearchResponse> {
    
    // 1. Generate Embedding
    let start_embed = Instant::now();
    let embeddings = {
        let mut model = state.model.lock().await;
        model.embed(vec![payload.text.clone()], None).unwrap()
    };
    let query_vector = &embeddings[0];
    let embed_time_ms = start_embed.elapsed().as_millis();

    // 2. Perform Search (In-Memory!)
    let start_search = Instant::now();
    
    let mut scored_docs: Vec<(f32, IconDoc)> = state.db.iter().map(|doc| {
        let score = cosine_similarity(query_vector, &doc.embedding);
        (score, doc.clone())
    }).collect();

    // Sort descending by score
    scored_docs.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    
    let top_docs: Vec<IconDoc> = scored_docs.into_iter()
        .take(12)
        .map(|(_, doc)| doc)
        .collect();

    let search_time_ms = start_search.elapsed().as_millis();

    Json(SearchResponse {
        embed_time_ms,
        search_time_ms,
        results: top_docs,
    })
}
