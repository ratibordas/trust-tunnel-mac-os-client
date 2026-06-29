import type { ClientConfig } from '@shared/types'

/** A blank-but-valid-shaped config for the manual editor (endpoint must be filled in). */
export function emptyConfig(): ClientConfig {
  return {
    loglevel: 'info',
    vpn_mode: 'general',
    killswitch_enabled: true,
    killswitch_allow_ports: [],
    post_quantum_group_enabled: true,
    exclusions_tcp_early_ack_enabled: false,
    exclusions_preresolve_enabled: true,
    exclusions_preresolve_max_queries: 50,
    exclusions: [],
    dns_upstreams: [],
    endpoint: {
      hostname: '',
      addresses: [],
      has_ipv6: true,
      username: '',
      password: '',
      client_random: '',
      skip_verification: false,
      certificate: null,
      upstream_protocol: 'http2',
      anti_dpi: false,
      dns_upstreams: []
    },
    listener: {
      tun: {
        included_routes: ['0.0.0.0/0', '2000::/3'],
        excluded_routes: [],
        mtu_size: 1350,
        tcp_recv_buf_size: 0,
        tcp_send_buf_size: 0,
        change_system_dns: true,
        device_name: '',
        use_existing: false
      }
    }
  }
}

export function linesToArray(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

export function arrayToLines(arr: string[] | undefined): string {
  return (arr ?? []).join('\n')
}

export function portsToArray(text: string): number[] {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n))
}
