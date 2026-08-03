ARG TEE_PROXY_VERSION=v0.0.21
FROM golang:1.25.1-alpine AS build

RUN apk add --no-cache git
ARG TEE_PROXY_VERSION
WORKDIR /src
RUN git clone --depth 1 --branch "${TEE_PROXY_VERSION}" https://github.com/flare-foundation/tee-proxy.git .
RUN go mod download
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w -buildid=" -o /tee-proxy ./cmd/proxy

FROM alpine:3.21
RUN addgroup -g 1001 -S quietline && adduser -u 1001 -S quietline -G quietline
WORKDIR /app
COPY --from=build /tee-proxy /app/tee-proxy
USER quietline
EXPOSE 6663 6664
ENTRYPOINT ["/app/tee-proxy"]
