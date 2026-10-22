// Image-build gate: verify the final Node binary and its public trust stores.
const assert = require('node:assert/strict');
const { X509Certificate } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { rootCertificates } = require('node:tls');

const compromised = '86a1ecba089c4a8d3bbe2734c612ba341d813e043cf9e8a862cd5c57a36bbe6b';
const floors = { 22: [23, 4], 24: [22, 1], 26: [12, 1] };
const [major, minor, patch] = process.versions.node.split('.').map(Number);
const floor = floors[major];
assert(floor && (minor > floor[0] || (minor === floor[0] && patch >= floor[1])),
  `Unpatched or unsupported Node runtime: ${process.versions.node}`);
const pem = readFileSync('/etc/ssl/certs/ca-certificates.crt', 'utf8');
const bundles = {
  node: rootCertificates,
  os: pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [],
};
const stores = {};
for (const [name, certificates] of Object.entries(bundles)) {
  assert(certificates.length > 0, `Empty ${name} trust store`);
  for (const certificate of certificates) {
    const fingerprint = new X509Certificate(certificate).fingerprint256.replaceAll(':', '').toLowerCase();
    assert.notEqual(fingerprint, compromised, `Compromised CA present in ${name}`);
  }
  stores[name] = { certificates: certificates.length, compromisedRootPresent: false };
}
console.log(JSON.stringify({ node: process.versions.node, stores }));
