// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- ambient `*.proto` module type, needed wherever the lib is compiled from source (the app bundles it)
/// <reference path="./proto/proto-source.d.ts" />
import type { MethodDefinition, ServiceDefinition } from '@grpc/grpc-js';
import * as protobuf from 'protobufjs';

import grpcBrokerProto from './proto/grpc_broker.proto';
import grpcControllerProto from './proto/grpc_controller.proto';
import grpcStdioProto from './proto/grpc_stdio.proto';
import healthProto from './proto/health.proto';
import tfplugin6Proto from './proto/tfplugin6.proto';

/**
 * The vendored protocol definitions (`./proto`, official files with their license headers), parsed at start-up with
 * protobufjs (already in the tree through grpc's proto-loader). No generated code: messages are plain objects with
 * the proto field names (`keepCase`), int64 as numbers, bytes as Buffers.
 */
const CONVERSION: protobuf.IConversionOptions = {
  longs: Number,
  enums: Number,
  bytes: Buffer,
  defaults: false,
  arrays: true,
  objects: true,
  oneofs: true,
};

let root: protobuf.Root | undefined;

/** The parsed root with every vendored file and the well-known google types they import. */
export function protocolRoot(): protobuf.Root {
  if (root) return root;

  const r = new protobuf.Root();

  for (const common of ['google/protobuf/empty.proto', 'google/protobuf/timestamp.proto']) {
    const json = protobuf.common.get(common);

    if (json?.nested) r.addJSON(json.nested);
  }

  for (const source of [tfplugin6Proto, grpcStdioProto, grpcControllerProto, grpcBrokerProto, healthProto])
    protobuf.parse(source, r, { keepCase: true });

  r.resolveAll();
  root = r;

  return r;
}

function methodDefinition(
  service: string,
  method: protobuf.Method,
): MethodDefinition<Record<string, unknown>, Record<string, unknown>> {
  const request = method.resolvedRequestType;
  const response = method.resolvedResponseType;

  if (!request || !response) throw new Error(`unresolved types of ${service}/${method.name}`);

  return {
    path: `/${service}/${method.name}`,
    requestStream: !!method.requestStream,
    responseStream: !!method.responseStream,
    requestSerialize: (value) => Buffer.from(request.encode(request.fromObject(value)).finish()),
    requestDeserialize: (bytes) => request.toObject(request.decode(bytes), CONVERSION),
    responseSerialize: (value) => Buffer.from(response.encode(response.fromObject(value)).finish()),
    responseDeserialize: (bytes) => response.toObject(response.decode(bytes), CONVERSION),
    originalName: method.name,
  };
}

/**
 * A grpc-js service definition of a vendored service, keyed by method name (`GetProviderSchema`, ...), e.g.
 * `serviceDefinition('tfplugin6.Provider')`.
 */
export function serviceDefinition(fullName: string): ServiceDefinition {
  const service = protocolRoot().lookupService(fullName);

  return Object.fromEntries(
    service.methodsArray.map((method) => [method.name, methodDefinition(fullName, method)]),
  ) as ServiceDefinition;
}

/** Encodes a message to bytes and back to the plain shape a handler receives (tests, the fake host). */
export function roundTrip(typeName: string, value: Record<string, unknown>): Record<string, unknown> {
  const type = protocolRoot().lookupType(typeName);

  return type.toObject(type.decode(type.encode(type.fromObject(value)).finish()), CONVERSION);
}
