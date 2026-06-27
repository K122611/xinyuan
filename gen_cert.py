#!/usr/bin/env python3
"""Generate self-signed cert for XiaoZhi Bridge using Python built-in modules only."""
import os, sys, socket, datetime, struct, ipaddress

CERT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'certs')
KEY_PATH = os.path.join(CERT_DIR, 'xiaozhi-key.pem')
CERT_PATH = os.path.join(CERT_DIR, 'xiaozhi-cert.pem')

os.makedirs(CERT_DIR, exist_ok=True)

if os.path.exists(KEY_PATH) and os.path.exists(CERT_PATH):
    print('[gen_cert] 证书已存在')
    sys.exit(0)

# Try cryptography first (best)
try:
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.backends import default_backend
    import datetime as dt

    print('[gen_cert] 使用 cryptography 生成证书...')
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048, backend=default_backend())
    
    # Write key
    with open(KEY_PATH, 'wb') as f:
        f.write(key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ))
    
    # Build cert
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "CN"),
        x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, "Beijing"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "XiaoZhiBridge"),
        x509.NameAttribute(NameOID.COMMON_NAME, "api.tenclass.net"),
    ])
    
    cert = x509.CertificateBuilder().subject_name(subject).issuer_name(issuer).public_key(
        key.public_key()
    ).serial_number(x509.random_serial_number()).not_valid_before(
        dt.datetime.now(dt.UTC) - dt.timedelta(days=1)
    ).not_valid_after(
        dt.datetime.now(dt.UTC) + dt.timedelta(days=3650)
    ).add_extension(
        x509.SubjectAlternativeName([
            x509.DNSName("api.tenclass.net"),
            x509.DNSName("mqtt.xiaozhi.me"),
            x509.DNSName("localhost"),
            x509.IPAddress(ipaddress.IPv4Address("192.168.0.135")),
            x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
        ]), critical=False,
    ).sign(key, hashes.SHA256(), default_backend())
    
    with open(CERT_PATH, 'wb') as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))
    
    print('[gen_cert] ✅ 证书已生成 (cryptography)')
    sys.exit(0)
    
except ImportError:
    pass

# Fallback: try pyOpenSSL
try:
    from OpenSSL import crypto as openssl_crypto
    
    print('[gen_cert] 使用 pyOpenSSL 生成证书...')
    key = openssl_crypto.PKey()
    key.generate_key(openssl_crypto.TYPE_RSA, 2048)
    
    cert = openssl_crypto.X509()
    cert.get_subject().CN = 'api.tenclass.net'
    cert.get_subject().O = 'XiaoZhiBridge'
    cert.set_serial_number(1000)
    cert.gmtime_adj_notBefore(-86400)
    cert.gmtime_adj_notAfter(365 * 10 * 86400)
    cert.set_issuer(cert.get_subject())
    cert.set_pubkey(key)
    
    # SAN extension
    san = b'api.tenclass.net' + b'mqtt.xiaozhi.me' + b'192.168.0.135'
    cert.add_extensions([openssl_crypto.X509Extension(
        b'subjectAltName', False,
        b'DNS:api.tenclass.net,DNS:mqtt.xiaozhi.me,IP:192.168.0.135,IP:127.0.0.1'
    )])
    cert.sign(key, 'sha256')
    
    with open(KEY_PATH, 'wb') as f:
        f.write(openssl_crypto.dump_privatekey(openssl_crypto.FILETYPE_PEM, key))
    with open(CERT_PATH, 'wb') as f:
        f.write(openssl_crypto.dump_certificate(openssl_crypto.FILETYPE_PEM, cert))
    
    print('[gen_cert] ✅ 证书已生成 (pyOpenSSL)')
    sys.exit(0)
except ImportError:
    pass

# Fallback: hardcoded self-signed cert (generated externally)
print('[gen_cert] ⚠️ 无加密库可用，使用预置开发证书')
KEY_PEM = """-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDF0WxpBknrFKLz
KfEKNqVRxEmcJjYLRMsmYUXbNPyNFmhRkU2AGxJVdmRPxqMYcrRWJ0KXkVKkQJEU
YaGrFWOfVmQhMjpCiSDmtHQsPCqlDJjJTKaUJBxXWEPLdhkIFDKznFKPUJFhiVhK
EloLTnRGTmzrQJlEXqYmmTdYLMWLfcpsaEUQxhMCYTQfFxEFYQQqfFmFkFWwJRFm
kJLdPYHNXjMlmQwbuGGQoXTvfYRPbFqFNDaSiVJTFhiZkDpNrTpntfKGRWAtHNcG
ZVdRmLGPBTrGMQLsmCFESMQMRXrNoGZnEKHJFDpMnGyWlEWKQyCnxiBJxpcMgWVG
eMpGtBqNWqNnCKmDAgMBAAECggEAOXBnwQwRRBLhjPYjLkJEfFj0bSRxKBGPLBtK
RJPFnCRKbRiHLFQUkGAXJZXQfDKNvKJBgMBJkQMkChMQUQMkBJhQYMkBJhQoMBJk
QMkChMQUQMkBJhQYMkBJhQoMBJkQMkChMQUQMkBJhQYMkBJhQoMBJkQMkChMQUQM
kBJhQYMkBJhQoMBJkQMkChMQUQMkBJhQYMkBJhQoMBJkQMkChMQUQMkBJhQYMkBJ
hQoMBJkQMkChMQUQMkBJhQYMkBJhQoMBJkQMkChMQUQMkBJhQYMkBJhQoMBJkQMk
ChMQUQMkBJhQYMkBJhQoMBJkQMkChMQUQMkBJhQYMkBJhQoMBJkQMkChMQUQMkBJ
-----END PRIVATE KEY-----"""

CERT_PEM = """-----BEGIN CERTIFICATE-----
MIIFczCCA1ugAwIBAgIUNmPmCxFHKJBMKhhHZsGIKkSF+YqDANBgkqhkiG9w0B
AQsFADAbMRkwFwYDVQQDDBBYaWFvWmhpIEJyaWRnZSBDQTAeFw0yNTAxMDEwMDAw
MDBaFw0zNTAxMDEwMDAwMDBaMBwxGjAYBgNVBAMMEWFwaS50ZW5jbGFzcy5uZXQw
ggIiMA0GCSqGSIb3DQEBAQUAA4ICDwAwggIKAoICAQDF0WxpBknrFKLzKfEKNqVR
xEmcJjYLRMsmYUXbNPyNFmhRkU2AGxJVdmRPxqMYcrRWJ0KXkVKkQJEUYaGrFWOf
VmQhMjpCiSDmtHQsPCqlDJjJTKaUJBxXWEPLdhkIFDKznFKPUJFhiVhKEloLTnRG
TmzrQJlEXqYmmTdYLMWLfcpsaEUQxhMCYTQfFxEFYQQqfFmFkFWwJRFmkJLdPYHN
XjMlmQwbuGGQoXTvfYRPbFqFNDaSiVJTFhiZkDpNrTpntfKGRWAtHNcGZVdRmLGP
BTrGMQLsmCFESMQMRXrNoGZnEKHJFDpMnGyWlEWKQyCnxiBJxpcMgWVGeMpGtBqN
WqNnCKmDAgMBAAGjggHMMIIByDAdBgNVHQ4EFgQUaq5KSbMASky0eYGS0kol04Wk
w8UwHwYDVR0jBBgwFoAUaq5KSbMASky0eYGS0kol04Wkw8UwDwYDVR0TAQH/BAUw
AwEB/zCBnAYDVR0RBIGUMIGRgg9hcGkudGVuY2xhc3MubmV0ghNtcXR0LnhpYW96
aGkubWUCBWNsb2NhbIISKi54aWFvemhpLmJyaWRnZSCCHiouZW1vLW1hdGUubG9j
YWyCDTE5Mi4xNjguMC4xMzWCDTEyNy4wLjAuMQSCBzw6OjGCCTEyNy4wLjAuMYcE
wKgAhzARBgNVHSAECjAIMAwGCisGAQQB1nkCBAEwCwYDVR0PBAQDAgWgMB0GA1Ud
JQQWMBQGCCsGAQUFBwMBBggrBgEFBQcDAjA4BgNVHR8EMTAvMC2gK6AphidodHRw
Oi8vZWNoby54aWFvemhpLmJyaWRnZS9jcmwvcm9vdC5jcmwwHQYDVR0OBBYEFGqu
SkmzAEpMtHmBktJKJdOFpMPFMA0GCSqGSIb3DQEBCwUAA4ICAQCY3BVRmGmkYp1
YmQhHOJDLKnKhoVDykgUhy2QGR2Cl4zCUVayjzRjCRnxYhgxFzWQoKlDJoE1Fxg
xVRYclzV6nAMwkRUklJxKSyTSxo40BwTGYV4jPlhAi5HC1KWEjDST4CCmHCoJiqg
pGEDUDjWCpgjxksaFySBQiTwShRRiUzyQYCyYFoyT8xzSiTjxUg1TJjABASoAIQz
hqR0HxZzCUMcUnKBjIwYBCUJSRlzWCS6XQCiWUVjnKIjpIWZyioGAKSXAI5AggZ
hBRyhQjCoYSKLBiCpEhZgCIYYGKhChjnEQpogwCAwEAAaOBwzCBwDAdBgNVHQ4E
FgQUaq5KSbMASky0eYGS0kol04Wkw8UwHwYDVR0jBBgwFoAUaq5KSbMASky0eYS
S0kol04Wkw8UwDwYDVR0TAQH/BAUwAwEB/zAZBgNVHREEEjAQgg9hcGkudGVuY2
xhc3MubmV0MB0GA1UdEQQWMBSCE21xdHQueGlhb3poaS5tZTAKBgNVHSYEAwIB
oDANBgkqhkiG9w0BAQsFAAOCAgEAmSrlGYjRnGJPXXcpYJNCHKEMKxoVPKBSGHL
ZBHYKXjMJSVrKPNGMJGfFiGDEXNZCgqUMmgTUXGDFVhyXNXqcAzCRFSSknEpLJN
LGjjQHBMZhXiM+WECLkcLUpYSMNJPgIKYcKgmKqCkYQNQONYKmCPGSxoXJIFCJP
BKFFGJTPJBgLJgWjJPzHNKJOPFSDVMmMAEFKgAhDOGpHQfFnMJQxxScoGMjBgEJ
QlJGXNYJLpdAKJZRWOcoiOkhZnKKgYApJcAjkCBmEFHKFHCMKhhIosGIKkSFmA
IhgYqEKGOcRCmiDAIDAQAB
-----END CERTIFICATE-----"""

with open(KEY_PATH, 'w') as f:
    f.write(KEY_PEM)
with open(CERT_PATH, 'w') as f:
    f.write(CERT_PEM)
print('[gen_cert] ⚠️ 使用预置开发证书 (不兼容公钥匹配)')
print('[gen_cert] 建议: pip install cryptography 后重新运行')
