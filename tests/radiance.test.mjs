// Contract captured from Radiance v1.12.0 (5a9ce491): core/server/{oai,admin}.cpp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probe } from '../scripts/discover-local-models.mjs';
import { reconcile, providerId } from '../scripts/sync-local-models.mjs';
import { initializeModels } from '../scripts/initialize-models.mjs';
const id = 'Qwen3.8-Flash-Next IQ4R';
const model = { id, owned_by: 'radiance', max_model_len: 262144, root: '/models/model.rad',
  capabilities: { chat: true, image: true, reasoning: true, reasoning_efforts: ['none','minimal','low','medium','xhigh'] } };
const info = { server: { model: id }, engine: { arch: 'qwen4exp', quant: 'bf16', n_ctx_train: 262144 } };
const props = { default_generation_settings:{n_ctx:262144}, modalities:{vision:true}, chat_template:'fixture', chat_template_caps:{supports_thinking:true} };
const fixture = (models=[model], metadata=info) => ({ fetchImpl: async url =>
  url.endsWith('/v1/models') ? Response.json({ data: models }) : url.endsWith('/props') ? Response.json(props) : url.endsWith('/server_info') && metadata ? Response.json(metadata) : new Response('', { status:404 }) });
const empty = () => ({ version:1, entries:{} });
test('Radiance advertises exact thinking levels and vision independently of its architecture ID', async () => {
  const report = await probe('http://localhost:8000', fixture());
  const m = report.models[0];
  assert.equal(m.engineHint, 'Radiance');
  assert.equal(m.displayName,id);
  assert.equal(m.architecture,'qwen4exp');
  assert.equal(m.containerQuantization,'bf16');
  assert.equal(m.imageSupport,true);
  assert.equal(m.contextWindow,262144);
  const result = reconcile({},empty(),[report]);
  const saved = result.config.providers[providerId(report.endpoint)].models[0];
  assert.equal(saved.name,id);
  assert.equal(saved.id,id);
  assert.equal(saved.compat.thinkingFormat,'openai');
  assert.equal(saved.compat.supportsReasoningEffort,true);
  assert.deepEqual(saved.thinkingLevelMap,{off:'none',minimal:null,low:'low',medium:'medium',high:null,xhigh:'xhigh',max:null});
  assert.deepEqual(saved.input,['text','image']);
  assert.equal(saved.maxTokens,32768);
});
test('generic architecture IDs remain unchanged; no quantization or model identity is invented', async () => {
  const report = await probe('http://localhost:8000',fixture([{...model,id:'qwen4exp'}]));
  assert.equal(report.models[0].displayName,'qwen4exp');
  assert.equal(report.models[0].architecture,null); // server_info belongs to another model
  assert.equal(report.models[0].containerQuantization,null);
});
test('optional server_info failure preserves advertised capabilities', async () => {
  const report=await probe('http://localhost:8000',fixture([model],null));
  assert.equal(report.status,'model-list');
  assert.equal(report.models[0].imageSupport,true);
  assert.equal(report.models[0].thinkingProfile,'openai-effort');
});
test('missing, malformed and unknown thinking levels do not become guessed controls', async () => {
  for (const efforts of [null, [], 'low', [2], ['future-level']]) {
    const report=await probe('http://localhost:8000',fixture([{...model,capabilities:{reasoning:true,reasoning_efforts:efforts}}]));
    assert.equal(report.models[0].thinkingProfile,null);
    assert.equal(report.models[0].imageSupport,true); // valid single-model /props metadata
  }
  const report=await probe('http://localhost:8000',fixture([{...model,capabilities:{reasoning:false,image:false}}]));
  assert.equal(report.models[0].thinkingProfile,'disabled');
  assert.equal(report.models[0].imageSupport,false);
});
test('Radiance metadata is per-model in a router and does not label other servers', async () => {
  const report=await probe('http://localhost:8000',fixture([model,{id:'another',max_model_len:8192,owned_by:'unknown',capabilities:model.capabilities}]));
  assert.equal(report.models[0].imageSupport,true);
  assert.equal(report.models[1].imageSupport,null);
  assert.equal(report.models[1].thinkingProfile,null);
  assert.equal(report.models[1].architecture,null);
});
test('custom model names and thinking configuration survive Radiance refresh', async () => {
  const report=await probe('http://localhost:8000',fixture());
  const first=reconcile({},empty(),[report]);
  const p=providerId(report.endpoint);
  first.config.providers[p].models[0].name='My local model';
  first.config.providers[p].models[0].thinkingLevelMap={off:'none',low:'low'};
  first.config.providers[p].models[0].contextWindow=8192;
  first.config.providers[p].models[0].input=['text'];
  const next=reconcile(first.config,empty(),[report],{adoptLocal:true});
  assert.deepEqual(next.conflicts,[]);
  assert.equal(next.config.providers[p].models[0].contextWindow,262144);
  assert.deepEqual(next.config.providers[p].models[0].input,['text','image']);
  assert.equal(next.config.providers[p].models[0].name,'My local model');
  assert.deepEqual(next.config.providers[p].models[0].thinkingLevelMap,{off:'none',low:'low'});
});
test('fresh initialization discovers a real HTTP Radiance fixture before a Pi session exists', async () => {
  const server=createServer((req,res)=>{
    const body=req.url==='/v1/models'?{data:[model]}:req.url==='/server_info'?info:req.url==='/props'?props:null;
    res.writeHead(body?200:404,{'Content-Type':'application/json'});res.end(JSON.stringify(body));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const root=await mkdtemp(join(tmpdir(),'radiance-discovery-'));
  try {
    await writeFile(join(root,'local-pi-models.json'),JSON.stringify({host:'127.0.0.1',ports:String(server.address().port)}));
    await initializeModels(root,{log:()=>{}});
    const saved=JSON.parse(await readFile(join(root,'models.json'),'utf8'));
    const m=Object.values(saved.providers)[0].models[0];
    assert.equal(m.id,id);assert.equal(m.name,id);assert.equal(m.reasoning,true);
    assert.equal(m.thinkingLevelMap.xhigh,'xhigh');assert.deepEqual(m.input,['text','image']);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});

test('Radiance non-chat models are skipped with a reason, including image-edit input', async () => {
  for (const capabilities of [{chat:false,embedding:true},{chat:false,image_generation:true,image:true}]) {
    const report=await probe('http://localhost:8000',fixture([{...model,capabilities}]));
    assert.equal(report.status,'empty-model-list');
    assert.deepEqual(report.models,[]);
    const result=reconcile({},empty(),[report]);
    assert.deepEqual(result.config.providers,{});
    assert(result.warnings.some(w=>w.reason.includes('no chat support')));
  }
});
test('Radiance LoRA cards use per-model capabilities and context with real props present', async () => {
  const report=await probe('http://localhost:8000',fixture([model,{...model,id:'lora-example',parent:id,max_model_len:65536}]));
  assert.equal(report.models.length,2);
  assert.equal(report.models[1].contextWindow,65536);
  assert.equal(report.models[1].imageSupport,true);
  assert.equal(report.models[1].thinkingLevelMap.xhigh,'xhigh');
  assert.equal(report.models[1].architecture,null);
});
