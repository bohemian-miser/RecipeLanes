# CTF runtime resources, adopted into Terraform (imported from the live
# resources that were first created imperatively while bringing the site up).
# See runtime-adopt.sh for the import commands.

# --- Firestore (permanent location: asia-southeast1, co-located w/ backend) --
resource "google_firestore_database" "default" {
  project     = google_project.ctf.project_id
  name        = "(default)"
  location_id = "asia-southeast1"
  type        = "FIRESTORE_NATIVE"

  depends_on = [google_project_service.ctf]
}

# --- Vertex AI access for the App Hosting runtime SA -------------------------
# Without this the recipe parser (genkit vertexAI, gemini-2.5-flash) fails with
# "Invalid AI Response Format".
resource "google_project_iam_member" "apphosting_aiplatform" {
  project = google_project.ctf.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:firebase-app-hosting-compute@${google_project.ctf.project_id}.iam.gserviceaccount.com"
}

# --- Firebase Auth / Identity Platform config -------------------------------
# Manages the authorized-domains list for Google sign-in popups. The Google
# provider itself (google_identity_platform_default_supported_idp_config) is
# NOT managed here: it needs an OAuth client_id/secret that the Firebase console
# auto-provisions and that would be a credential in this PUBLIC repo — enabling
# it stays a one-time console click (documented in README).
resource "google_identity_platform_config" "auth" {
  project = google_project.ctf.project_id

  authorized_domains = [
    "recipe-lanes-ctf.firebaseapp.com",
    "recipe-lanes-ctf.web.app",
    "ctf--recipe-lanes-ctf.asia-southeast1.hosted.app",
    "ctf.recipelanes.com",
    "localhost",
  ]

  depends_on = [google_project_service.ctf]
}
