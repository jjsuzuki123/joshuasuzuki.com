# Sniper Lambda container image.
#
# Bundles the curl-impersonate shared library so `impers` can present a real
# Chrome TLS/JA3/JA4 + HTTP-2 fingerprint from inside Lambda (the default Node
# OpenSSL handshake is trivially flagged by Cloudflare/WAFs).
#
# Build context is the rsvp-backend/ directory:
#   docker build -f sniper/Dockerfile -t rsvp-sniper .
#
# The image is built for arm64 to match the Lambda function architecture.

FROM public.ecr.aws/lambda/nodejs:22 AS build

# curl-impersonate release to bundle. Overridable at build time.
ARG CURL_IMPERSONATE_VERSION=1.0.0
# aarch64 for arm64 Lambdas, x86_64 for x86_64 Lambdas.
ARG CURL_IMPERSONATE_ARCH=aarch64

# tar/gzip and a downloader are needed to fetch the prebuilt library.
RUN dnf install -y tar gzip findutils && dnf clean all

WORKDIR /opt/curl-impersonate
RUN set -eux; \
    url="https://github.com/lexiforest/curl-impersonate/releases/download/v${CURL_IMPERSONATE_VERSION}/libcurl-impersonate-v${CURL_IMPERSONATE_VERSION}.${CURL_IMPERSONATE_ARCH}-linux-gnu.tar.gz"; \
    echo "Fetching ${url}"; \
    curl -fsSL "${url}" -o libcurl-impersonate.tar.gz; \
    tar -xzf libcurl-impersonate.tar.gz; \
    mkdir -p /usr/local/lib; \
    cp -av libcurl-impersonate*.so* /usr/local/lib/ 2>/dev/null || true; \
    lib="$(find /usr/local/lib -name 'libcurl-impersonate*.so*' | head -n1)"; \
    test -n "${lib}"; \
    ln -sf "${lib}" /usr/local/lib/libcurl-impersonate.so; \
    ldconfig || true

WORKDIR ${LAMBDA_TASK_ROOT}

# Install sniper dependencies (impers + AWS SDK clients) at the task root so
# both the handler and the shared modules resolve node_modules by walking up.
COPY sniper/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

# Preserve the repo layout so the source's relative requires resolve:
# sniper/index.js -> ../resy-client.js, ./snipe-core.js;
# sniper/snipe-core.js -> ../slot-ranking.js. Build context is rsvp-backend/.
COPY resy-client.js ./resy-client.js
COPY slot-ranking.js ./slot-ranking.js
COPY release-rules.js ./release-rules.js
COPY data ./data
COPY sniper/index.js ./sniper/index.js
COPY sniper/snipe-core.js ./sniper/snipe-core.js

FROM public.ecr.aws/lambda/nodejs:22

# Bring the impersonation library and node deps/source over.
COPY --from=build /usr/local/lib/libcurl-impersonate* /usr/local/lib/
COPY --from=build ${LAMBDA_TASK_ROOT} ${LAMBDA_TASK_ROOT}

# Ensure the dynamic loader and impers can find the library at a search path.
ENV LD_LIBRARY_PATH=/usr/local/lib:${LD_LIBRARY_PATH}
RUN ldconfig || true

CMD [ "sniper/index.handler" ]
