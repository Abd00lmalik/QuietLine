ARG SOURCE_DATE_EPOCH=0
FROM golang:1.25.1-bookworm AS build
ARG SOURCE_DATE_EPOCH
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w -buildid=" -o /quietline ./cmd/docker

FROM gcr.io/distroless/static-debian12:nonroot
ARG SOURCE_DATE_EPOCH
LABEL "tee.launch_policy.allow_env_override"="LOG_LEVEL,PROXY_URL,INITIAL_OWNER,EXTENSION_ID,CHAIN_URL,CHAIN_ID,MODE,SIMULATED_TEE,GOVERNANCE_SIGNERS,GOVERNANCE_THRESHOLD,CONFIG_PORT,SIGN_PORT,EXTENSION_PORT,STATE_PATH,STATE_ENCRYPTION_KEY,QUIET_VAULT,FXRP_ADDRESS,USDT0_ADDRESS"
COPY --from=build /quietline /quietline
USER 0:0
EXPOSE 5501 7701 7702
ENTRYPOINT ["/quietline"]
