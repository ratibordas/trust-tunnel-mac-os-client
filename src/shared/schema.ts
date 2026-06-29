import { z } from 'zod'

// Validation schema for trusttunnel_client.toml, mirroring the upstream
// "configuration reference":
// https://github.com/TrustTunnel/TrustTunnelClient/blob/master/trusttunnel/README.md#configuration-reference
//
// Anything the CLI treats as optional has a default here so a minimal config
// (just an [endpoint]) round-trips cleanly.

const hostPort = z
  .string()
  .trim()
  .min(1)
  .regex(
    // host:port — IPv4/hostname/[IPv6]:port. Best-effort; the CLI is the final word.
    /^(\[[0-9a-fA-F:]+\]|[^\s:]+):\d{1,5}$/,
    'Expected "host:port" (e.g. "1.2.3.4:443" or "vpn.example.com:443")'
  )

const dnsUpstream = z
  .string()
  .trim()
  .min(1)
  .refine(
    (v) =>
      /^(tcp|tls|https|quic|sdns):\/\//.test(v) ||
      /^[^\s/]+(:\d{1,5})?$/.test(v),
    'Expected plain "ip:53" or a scheme URL (tcp://, tls://, https://, quic://, sdns://)'
  )

// Exclusions accept domains, wildcards, IPv4/IPv6, CIDR, and *:port. We only
// reject obviously empty / whitespace entries; the CLI validates the rest.
const exclusion = z.string().trim().min(1)

export const TunListenerSchema = z.object({
  bound_if: z.string().trim().optional(),
  included_routes: z.array(z.string().trim().min(1)).default(['0.0.0.0/0', '2000::/3']),
  excluded_routes: z.array(z.string().trim().min(1)).default([]),
  mtu_size: z.number().int().min(576).max(9000).default(1350),
  tcp_recv_buf_size: z.number().int().min(0).default(0),
  tcp_send_buf_size: z.number().int().min(0).default(0),
  change_system_dns: z.boolean().default(true),
  device_name: z.string().default(''),
  use_existing: z.boolean().default(false)
})

export const SocksListenerSchema = z.object({
  address: hostPort.default('127.0.0.1:1080'),
  username: z.string().nullable().default(null),
  password: z.string().nullable().default(null)
})

export const ListenerSchema = z
  .object({
    tun: TunListenerSchema.optional(),
    socks: SocksListenerSchema.optional()
  })
  .refine((l) => l.tun || l.socks, 'Define at least one listener: [listener.tun] or [listener.socks]')

export const EndpointSchema = z.object({
  hostname: z.string().trim().min(1, 'Endpoint hostname is required'),
  addresses: z.array(hostPort).min(1, 'At least one endpoint address is required'),
  has_ipv6: z.boolean().default(true),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  client_random: z.string().default(''),
  skip_verification: z.boolean().default(false),
  certificate: z.string().nullable().default(null),
  upstream_protocol: z.enum(['http2', 'http3']).default('http2'),
  anti_dpi: z.boolean().default(false),
  dns_upstreams: z.array(dnsUpstream).default([])
})

export const ClientConfigSchema = z.object({
  loglevel: z.enum(['info', 'debug', 'trace']).default('info'),
  vpn_mode: z.enum(['general', 'selective']).default('general'),
  killswitch_enabled: z.boolean().default(true),
  killswitch_allow_ports: z.array(z.number().int().min(1).max(65535)).default([]),
  post_quantum_group_enabled: z.boolean().default(true),
  exclusions_tcp_early_ack_enabled: z.boolean().default(false),
  exclusions_preresolve_enabled: z.boolean().default(true),
  exclusions_preresolve_max_queries: z.number().int().min(0).default(50),
  exclusions: z.array(exclusion).default([]),
  dns_upstreams: z.array(dnsUpstream).default([]),
  endpoint: EndpointSchema,
  listener: ListenerSchema.default({ tun: {} as z.input<typeof TunListenerSchema> })
})

export type ClientConfig = z.infer<typeof ClientConfigSchema>
export type ClientConfigInput = z.input<typeof ClientConfigSchema>

export interface ValidationIssue {
  path: string
  message: string
}

export interface ValidationResult {
  ok: boolean
  issues: ValidationIssue[]
  /** Parsed + defaulted config when ok === true. */
  value?: ClientConfig
}

export function validateConfig(raw: unknown): ValidationResult {
  const parsed = ClientConfigSchema.safeParse(raw)
  if (parsed.success) {
    return { ok: true, issues: [], value: parsed.data }
  }
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => ({
      path: i.path.join('.') || '(root)',
      message: i.message
    }))
  }
}
