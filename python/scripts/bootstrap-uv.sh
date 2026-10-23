#!/bin/sh
set -eu

# This alternate pipeline runs on the Debian Python image.
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl
update-ca-certificates
rm -rf /var/lib/apt/lists/*
PIP_BOOTSTRAP_DIR="$(mktemp -d)"
PIP_WHEEL="$PIP_BOOTSTRAP_DIR/pip-26.2.2-py3-none-any.whl"
trap 'rm -f "$PIP_WHEEL"; rmdir "$PIP_BOOTSTRAP_DIR"' EXIT
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 \
    https://files.pythonhosted.org/packages/3f/06/3e4420302363fbb71be3c7f35ce042f54bfca330e3e66b3a2e3c4cca579f/pip-26.2.2-py3-none-any.whl \
    --output "$PIP_WHEEL"
printf '%s  %s\n' fd7f4dfa8190e014013b9f08f3e973f4e4c26ffd179a204895533a7254813a70 "$PIP_WHEEL" | sha256sum --check --status
PYTHONPATH="$PIP_WHEEL" python -m pip install --no-index --no-deps "$PIP_WHEEL"
python -m pip install --no-cache-dir "certifi>=2026.10.19" "uv==0.13.5"
python - <<'PY'
import certifi
import hashlib
import ssl
from pip._vendor import certifi as pip_ca

stores = [ssl.create_default_context(cafile=p) for p in (
    certifi.where(), pip_ca.where(), "/etc/ssl/certs/ca-certificates.crt",
)]
assert all(store.get_ca_certs() for store in stores)
assert all(
    hashlib.sha256(certificate).hexdigest() != "86a1ecba089c4a8d3bbe2734c612ba341d813e043cf9e8a862cd5c57a36bbe6b"
    for store in stores for certificate in store.get_ca_certs(binary_form=True)
)
PY
