# Cloud DNS zone for recipelanes.com — homed in recipe-lanes-infra.
#
# Migrated here from envs/prod (a Cloud DNS zone can't move between projects,
# so this is a fresh zone with identical records). Cutover, IF the new zone
# draws a different nameserver set than the current one:
#   1. apply this env  ->  `terraform output recipelanes_nameservers`
#   2. set those four nameservers at Namecheap (registration stays there)
#   3. verify propagation, THEN remove the zone from envs/prod (destroys the old)
# If the NS set matches the current one, no Namecheap change is needed — just
# retire the prod zone.
#
# Records replicate the live zone EXACTLY (verified against live DNS 2026-07-07),
# including the Google Workspace mail records (MX + DKIM). Do not drop the mail
# records — commercial@recipelanes.com depends on them.

resource "google_project_service" "dns" {
  project            = "recipe-lanes-infra"
  service            = "dns.googleapis.com"
  disable_on_destroy = false
}

resource "google_dns_managed_zone" "recipelanes_com" {
  project     = "recipe-lanes-infra"
  name        = "recipelanes-com"
  dns_name    = "recipelanes.com."
  description = "Primary zone for recipelanes.com (registration stays at Namecheap)"

  depends_on = [google_project_service.dns]
}

# --- app records -------------------------------------------------------------

resource "google_dns_record_set" "apex_a" {
  project      = "recipe-lanes-infra"
  managed_zone = google_dns_managed_zone.recipelanes_com.name
  name         = "recipelanes.com."
  type         = "A"
  ttl          = 300
  rrdatas      = ["35.219.201.32"]
}

resource "google_dns_record_set" "staging_a" {
  project      = "recipe-lanes-infra"
  managed_zone = google_dns_managed_zone.recipelanes_com.name
  name         = "staging.recipelanes.com."
  type         = "A"
  ttl          = 300
  rrdatas      = ["35.219.201.32"]
}

# Firebase App Hosting certificate-manager ACME delegation.
resource "google_dns_record_set" "acme_delegation" {
  project      = "recipe-lanes-infra"
  managed_zone = google_dns_managed_zone.recipelanes_com.name
  name         = "_acme-challenge_g53jojzkijdgy3a6.recipelanes.com."
  type         = "CNAME"
  ttl          = 3600
  rrdatas      = ["2d9afdaa-ed30-4f2b-a268-7495ea23a993.9.authorize.certificatemanager.goog."]
}

# App Hosting domain claim + Search Console site verification.
resource "google_dns_record_set" "apex_txt" {
  project      = "recipe-lanes-infra"
  managed_zone = google_dns_managed_zone.recipelanes_com.name
  name         = "recipelanes.com."
  type         = "TXT"
  ttl          = 3600
  rrdatas = [
    "\"fah-claim=00b-02-9b4dd8b4-d55b-4b72-9a94-0b510f060e16\"",
    "\"google-site-verification=Jw5_py56FKCwh8Mhn97gD5hGnkI4MTM_IkF_hEkoGuA\"",
  ]
}

# --- Google Workspace mail (load-bearing: commercial@recipelanes.com) --------

resource "google_dns_record_set" "apex_mx" {
  project      = "recipe-lanes-infra"
  managed_zone = google_dns_managed_zone.recipelanes_com.name
  name         = "recipelanes.com."
  type         = "MX"
  ttl          = 3600
  rrdatas      = ["1 smtp.google.com."]
}

# DKIM key; >255 chars, so it stays split into the two quoted chunks exactly
# as served by the current zone.
resource "google_dns_record_set" "dkim_txt" {
  project      = "recipe-lanes-infra"
  managed_zone = google_dns_managed_zone.recipelanes_com.name
  name         = "google._domainkey.recipelanes.com."
  type         = "TXT"
  ttl          = 3600
  rrdatas = [
    "\"v=DKIM1;k=rsa;p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArSCD0IiYejtZ4GxgYFjem8e6LRjPhVaXTe4OwMnIStlGgwf2v+sZ0my0ztx4iGjn7OWFevbwK0yD6DLSbl+ykLY3XPnyCkhpkVqSM00LHYouI/nkOUhVEsJTZlvKJBpYaL89cRO6kbUBYZ3sfolWDE+NvdZeDYmPzhqCVedlHCEGP+MLtCaD7NcmLe/Vsu2Odyk\" \"9iBdDeiUce+Sn4IKommH0KeFFrD/5jYwogeO/o7wM5POfSh//6q8W07VrrNFHP1gCbFyPaIv3YxUGmBos7aqckZigAcyL0psyRSknePk3+DrAhhQg3kMizwwaINdN1Fq0g6BM7dm6/sNqdH5KGwIDAQAB\"",
  ]
}

output "recipelanes_nameservers" {
  description = "Nameservers for the infra-homed zone. Compare to the current NS; if different, set these at Namecheap to complete the move."
  value       = google_dns_managed_zone.recipelanes_com.name_servers
}
