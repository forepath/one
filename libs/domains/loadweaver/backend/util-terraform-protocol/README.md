# loadweaver-backend-util-terraform-protocol

Terraform's plugin protocol in TypeScript, for the Loadweaver Terraform provider: go-plugin handshake with AutoMTLS,
gRPC server for `tfplugin6` (plus go-plugin's stdio / controller / broker services and the health check), cty values
with the msgpack `DynamicValue` encoding, and schema conversion. The official protocol files are vendored in
`src/lib/proto` with their license headers.

Run `nx test loadweaver-backend-util-terraform-protocol` to execute the unit tests.
