#!/usr/bin/env node
// Read-only discovery prototype. Never writes Pi configuration or runs inference.
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { discoverThinking } from './thinking.mjs';

export function expandTargets(host, ports) {
  if (!host || /[\s/@?#]/.test(host)) throw new Error('Supply a hostname or IP address');
  const unique = new Set();
  for (const part of ports.split(',')) {
    if (!/^\d+(?:-\d+)?$/.test(part)) throw new Error(`Invalid port specification: ${part}`);
    const [start, end = start] = part.split('-').map(Number);
    if (start < 1 || end > 65535 || end < start) throw new Error(`Invalid port range: ${part}`);
    if (end - start >= 256) throw new Error('At most 256 targets allowed');
    for (let port = start; port <= end; port++) unique.add(port);
    if (unique.size > 256) throw new Error('At most 256 targets allowed');
  }
  return [...unique].map(port => new URL(`http://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}`).origin);
}

export function gatewayEndpoint(endpoint, gateway) {
  const target = new URL(endpoint);
  if (target.protocol !== 'http:' || target.hostname !== 'local-model.internal' ||
      target.href !== target.origin + '/' || typeof gateway !== 'string' ||
      !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}(?:\/[a-z0-9-]+)*\/[a-z0-9-]*\{port\}$/.test(gateway)) {
    throw new Error('Use a loopback model gateway with a {port} suffix for local-model.internal.');
  }
  return new URL(gateway.replace('{port}', target.port || '80')).href;
}

export async function readJson(url, { timeoutMs = 3000, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
  if (!response.ok) {
    await response.body?.cancel();
    throw Object.assign(new Error(`HTTP ${response.status}`), { httpStatus: response.status });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('Response exceeds 1 MiB');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function positive(value) { return Number.isSafeInteger(value) && value > 0 ? value : null; }

function modelVision(model) {
  const input = model.architecture?.input_modalities;
  if (!Array.isArray(input) || !input.length || !input.every(value => typeof value === 'string' && value.length)) return null;
  return input.includes('image');
}

export async function probe(url, options = {}) {
  const report = { endpoint: url, status: 'unknown', models: [] };
  const upstream = options.gateway ? gatewayEndpoint(url, options.gateway) : url;
  if (options.gateway) report.gateway = options.gateway;
  try {
    const body = await readJson(`${upstream}/v1/models`, options);
    if (!Array.isArray(body?.data) || !body.data.every(m => m && typeof m.id === 'string' && m.id.length) || new Set(body.data.map(m => m.id)).size !== body.data.length) {
      return { ...report, status: 'invalid-model-list' };
    }
    report.status = body.data.length ? 'model-list' : 'empty-model-list';
    // /props supplies optional llama.cpp-compatible metadata (including Radiance).
    let props;
    if (body.data.length) {
      try { props = await readJson(`${upstream}/props`, options); } catch { /* Optional evidence. */ }
    }
    let radianceInfo;
    if (body.data.some(m => m.owned_by === 'radiance')) {
      try { radianceInfo = await readJson(`${upstream}/server_info`, options); } catch { /* Optional metadata. */ }
    }
    const serverContext = positive(props?.default_generation_settings?.n_ctx);
    report.models = body.data.map(m => {
      const context = serverContext ?? positive(m.context_length) ?? positive(m.max_model_len);
      const hasServerVision = body.data.length === 1 && typeof props?.modalities?.vision === 'boolean';
      const radiance = m.owned_by === 'radiance';
      const metadata = radiance && radianceInfo?.server?.model === m.id ? radianceInfo.engine : undefined;
      const engine = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : undefined;
      const radianceVision = radiance && typeof m.capabilities?.image === 'boolean';
      const vision = radianceVision ? m.capabilities.image : hasServerVision ? props.modalities.vision : modelVision(m);
      const thinking = discoverThinking(m, props, body.data.length === 1);
      return {
        id: m.id,
        displayName: typeof m.name === 'string' && m.name.trim() ? m.name : m.id,
        architecture: typeof engine?.arch === 'string' ? engine.arch : null,
        containerQuantization: typeof engine?.quant === 'string' ? engine.quant : null,
        metadataEvidence: engine ? '/server_info.engine (matching served model); container quantization may describe mixed weights incompletely' : null,
        availability: m.state ?? m.status?.value ?? 'unknown',
        engineHint: radiance ? 'Radiance' : m.owned_by === 'ds4.c' ? 'DwarfStar-family (build unverified)' : m.owned_by === 'gufo' ? 'Gufo (build unverified)' : serverContext ? 'llama.cpp-compatible props' : 'unknown',
        thinkingSupport: thinking.support,
        thinkingProfile: thinking.profile,
        thinkingLevelMap: thinking.levelMap,
        thinkingEvidence: thinking.evidence,
        thinkingWarning: thinking.warning,
        contextWindow: context,
        contextEvidence: serverContext ? '/props.default_generation_settings.n_ctx (single-server metadata; model mapping unverified)' : positive(m.context_length) ? '/v1/models.context_length (server-advertised)' : positive(m.max_model_len) ? '/v1/models.max_model_len (server-advertised)' : 'unknown',
        trainedContext: positive(engine?.n_ctx_train) ?? positive(m.meta?.n_ctx_train),
        imageSupport: vision,
        imageSupportEvidence: radianceVision ? '/v1/models.capabilities.image' : hasServerVision ? '/props.modalities.vision' : vision !== null ? '/v1/models.architecture.input_modalities (server-advertised)' : 'unknown; server supplied no supported vision metadata',
        maxCompletionTokensAdvertised: positive(m.top_provider?.max_completion_tokens),
        supportedParameters: Array.isArray(m.supported_parameters) ? m.supported_parameters.filter(p => typeof p === 'string') : null,
        apiCompatibility: 'model-list only; inference unverified',
      };
    });
    // A generic /props response cannot be assigned across a router's models.
    if (body.data.length > 1) {
      report.models.forEach((m, i) => {
        m.contextWindow = positive(body.data[i].context_length) ?? positive(body.data[i].max_model_len);
        m.contextEvidence = m.contextWindow ? '/v1/models (server-advertised)' : 'unknown; /props model mapping ambiguous';
        // Per-model advertised modalities remain valid when generic props are ambiguous.
        m.imageSupport = body.data[i].owned_by === 'radiance' && typeof body.data[i].capabilities?.image === 'boolean' ? body.data[i].capabilities.image : modelVision(body.data[i]);
      });
    }
    report.skippedModels = body.data.filter(m => m.owned_by === 'radiance' && m.capabilities?.chat === false)
      .map(m => ({ id: m.id, reason: 'Radiance reports no chat support' }));
    const skipped = new Set(report.skippedModels.map(m => m.id));
    report.models = report.models.filter(m => !skipped.has(m.id));
    if (!report.models.length) report.status = 'empty-model-list';
  } catch (error) {
    const code = error.cause?.code;
    const causes = error.cause?.errors ?? [];
    report.status = code === 'ECONNREFUSED' || causes.length && causes.every(e => e.code === 'ECONNREFUSED') ? 'closed' : error.httpStatus ? 'http-error' : error.name === 'TimeoutError' ? 'timeout' : 'probe-error';
    report.detail = error.message;
    if (error.httpStatus) report.httpStatus = error.httpStatus;
  }
  return report;
}

export async function scan(targets, { concurrency = 4, ...options } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('Concurrency must be 1–16');
  const unique = [...new Set(targets)];
  if (unique.length > 256) throw new Error('At most 256 targets allowed');
  const results = new Array(unique.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, async () => {
    while (next < unique.length) {
      const index = next++;
      results[index] = await probe(unique[index], options);
    }
  }));
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: { host: { type: 'string' }, ports: { type: 'string' } } });
    if (!values.host || !values.ports) throw new Error('Usage: node scripts/discover-local-models.mjs --host localhost --ports 8000-8009,8080-8089');
    const results = await scan(expandTargets(values.host, values.ports));
    console.log(JSON.stringify({ scannedAt: new Date().toISOString(), mode: 'read-only', results }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
