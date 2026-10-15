#pragma once
// Copy to secrets.h (ignored). Never commit the filled file.
#define AIRCHECK_WIFI_SSID ""
#define AIRCHECK_WIFI_PASSWORD ""
#define AIRCHECK_SERVER "https://aircheck.home.arpa"
#define AIRCHECK_DEVICE_ID "room-01"
#define AIRCHECK_TOKEN ""
// Paste the installation's Caddy root certificate, not the leaf certificate.
#define AIRCHECK_CA_PEM ""
// Both the build gate and commissioned=1 in NVS are required for outputs.
#ifndef AIRCHECK_OUTPUTS_COMMISSIONED
#define AIRCHECK_OUTPUTS_COMMISSIONED 0
#endif
#define AIRCHECK_SD_ENABLED 0
