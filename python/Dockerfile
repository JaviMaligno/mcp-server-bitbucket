# Dockerfile for Smithery deployment
FROM python:3.11-slim

# Refresh OS roots and bootstrap a hash-pinned pip before package resolution.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN python -m pip install --no-cache-dir \
    "pip @ https://files.pythonhosted.org/packages/3f/06/3e4420302363fbb71be3c7f35ce042f54bfca330e3e66b3a2e3c4cca579f/pip-26.2.2-py3-none-any.whl#sha256=fd7f4dfa8190e014013b9f08f3e973f4e4c26ffd179a204895533a7254813a70"

# Retain the Smithery deployment's published-package installation behavior.
RUN python -m pip install --no-cache-dir "certifi>=2026.10.19" mcp-server-bitbucket
RUN python -c 'import certifi, hashlib, ssl; from pip._vendor import certifi as pip_ca; \
    stores = [ssl.create_default_context(cafile=p) for p in [certifi.where(), pip_ca.where(), "/etc/ssl/certs/ca-certificates.crt"]]; \
    assert all(s.get_ca_certs() for s in stores); \
    assert all(hashlib.sha256(c).hexdigest() != "86a1ecba089c4a8d3bbe2734c612ba341d813e043cf9e8a862cd5c57a36bbe6b" for s in stores for c in s.get_ca_certs(binary_form=True))'

# Set the entrypoint
ENTRYPOINT ["mcp-server-bitbucket"]
