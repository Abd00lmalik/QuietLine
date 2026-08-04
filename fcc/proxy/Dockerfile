ARG TEE_PROXY_REF=0c6d016b09948cba9a508ba357e592eb6088fd1c
FROM golang:1.25.8-alpine AS build

RUN apk add --no-cache git
ARG TEE_PROXY_REF
WORKDIR /src
RUN git init \
    && git remote add origin https://github.com/flare-foundation/tee-proxy.git \
    && git fetch --depth 1 origin "${TEE_PROXY_REF}" \
    && git checkout --detach FETCH_HEAD
RUN go mod download
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w -buildid=" -o /tee-proxy ./cmd/proxy

FROM alpine:3.21
RUN addgroup -g 1001 -S quietline && adduser -u 1001 -S quietline -G quietline
WORKDIR /app
COPY --from=build /tee-proxy /app/tee-proxy
USER quietline
EXPOSE 6663 6664
ENTRYPOINT ["/app/tee-proxy"]
