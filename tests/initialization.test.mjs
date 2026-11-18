import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeModels } from '../scripts/initialize-models.mjs';
const endpoint='http://local-model.internal:8000';
const report={endpoint,status:'model-list',models:[{id:'local-test',contextWindow:8192,imageSupport:false}]};
async function setup(run) { const root=await mkdtemp(join(tmpdir(),'initial-models-'));try{await run(root);}finally{await rm(root,{recursive:true,force:true});} }
test('initial catalogue is written without loading Pi or selecting a model',async()=>setup(async root=>{
 const result=await initializeModels(root,{scanModels:async()=>[report],log:()=>{}});
 assert.deepEqual(result.models,['local-test']);
 const config=JSON.parse(await readFile(join(root,'models.json'),'utf8'));
 assert(Object.values(config.providers).some(p=>p.models[0].contextWindow===8192));
}));
test('unreachable server fails clearly and preserves unrelated providers',async()=>setup(async root=>{
 const config={providers:{remote:{baseUrl:'https://example.test/v1',models:[{id:'keep'}]}}};
 await writeFile(join(root,'models.json'),JSON.stringify(config));
 await assert.rejects(initializeModels(root,{scanModels:async()=>[{endpoint,status:'probe-error',models:[]}],log:()=>{}}),/No usable local model/);
 assert.deepEqual(JSON.parse(await readFile(join(root,'models.json'),'utf8')),config);
}));
test('unknown context cannot produce a supposedly ready fresh catalogue',async()=>setup(async root=>{
 await assert.rejects(initializeModels(root,{scanModels:async()=>[{...report,models:[{id:'unknown',contextWindow:null}]}],log:()=>{}}),/context limit/);
}));

test('a gateway moves an existing discovered model without changing its provider identity', async () => setup(async root => {
  await initializeModels(root, { scanModels: async () => [report], log: () => {} });
  const file = join(root, 'models.json');
  const original = JSON.parse(await readFile(file, 'utf8'));
  const gateway = 'http://127.0.0.1:19431/r/local-{port}';
  await writeFile(join(root, 'local-pi-models.json'), JSON.stringify({host:'local-model.internal', ports:'8000-8001', gateway}));
  const result = await initializeModels(root, { scanModels: async (targets, options) => {
    assert.deepEqual(targets, [endpoint, 'http://local-model.internal:8001']);
    assert.equal(options.gateway, gateway);
    return [{ ...report, gateway }, { endpoint: targets[1], gateway, status:'http-error', httpStatus:401, models:[] }];
  }, log: () => {} });
  assert.deepEqual(result.models, ['local-test']);
  assert(result.warnings.some(warning => warning.endpoint.endsWith(':8001') && warning.reason.includes('API key')));
  const updated = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(Object.keys(updated.providers), Object.keys(original.providers));
  const provider = Object.values(updated.providers)[0];
  assert.equal(provider.baseUrl, 'http://127.0.0.1:19431/r/local-8000/v1');
  assert.equal(provider.apiKey, 'not-needed');
}));
test('preview does not create models.json and does not require a ready server',async()=>setup(async root=>{
 await initializeModels(root,{preview:true,scanModels:async()=>[{endpoint,status:'probe-error',models:[]}],log:()=>{}});
 await assert.rejects(readFile(join(root,'models.json')), {code:'ENOENT'});
}));

test('fresh large-context catalogue gets a 32K output allowance', async () => setup(async root => {
  await initializeModels(root, { scanModels: async () => [{ ...report, models: [{ id: 'local-large', contextWindow: 67840, imageSupport: false }] }], log: () => {} });
  const config = JSON.parse(await readFile(join(root, 'models.json'), 'utf8'));
  assert.equal(Object.values(config.providers)[0].models[0].maxTokens, 32768);
}));
