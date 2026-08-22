function productionDceBatch_(campaignId,batchId){return findRow_('PRODUCTION_BATCHES',r=>String(r.ID)===String(batchId)&&String(r.CAMPAIGN_ID)===String(campaignId));}
function productionDceObjects_(campaignId,batchId){return sheetRows_(getSheet_('POSTAL_OBJECTS')).filter(r=>String(r.CAMPAIGN_ID)===String(campaignId)&&String(r.PRODUCTION_BATCH_ID)===String(batchId));}
function productionDceDeclaredValue_(postal){const raw=postal||{};const value=raw.VALOR_DECLARADO??raw.declaredValue??raw.valorDeclarado??raw.valor??'';return Number(String(value).replace(/\./g,'').replace(',','.').replace(/[^0-9.-]/g,''));}
function normalizeCityName_(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim();}
function lookupCityCode_(city,uf){const cache=CacheService.getScriptCache(),key='ibge:'+String(uf).toUpperCase()+':'+normalizeCityName_(city),cached=cache.get(key);if(cached)return cached;const url='https://servicodados.ibge.gov.br/api/v1/localidades/estados/'+encodeURIComponent(String(uf).toUpperCase())+'/municipios?orderBy=nome';const response=UrlFetchApp.fetch(url,{muteHttpExceptions:true});if(response.getResponseCode()!==200)throw new Error('IBGE indisponivel para '+uf+'.');const rows=JSON.parse(response.getContentText()||'[]');const match=rows.find(x=>normalizeCityName_(x.nome)===normalizeCityName_(city));if(!match)throw new Error('Codigo IBGE nao localizado para '+city+'/'+uf+'.');const code=String(match.id);cache.put(key,code,21600);return code;}
function buildProductionDceSource_(object) {
  const recipient = safeJsonParse_(object.RECIPIENT_JSON, {});
  const postal = safeJsonParse_(object.POSTAL_JSON, {});
  const address = recipient.address || {};
  const document = digits_(recipient.document || recipient.cpfCnpj || postal.CPF_CNPJ || postal.CPF || postal.CNPJ);
  const value = productionDceDeclaredValue_(postal);
  const content = String(object.CONTENT || postal.CONTEUDO || postal.content || '').trim();
  const issues = [];
  if (!(isValidCpf_(document) || isValidCnpj_(document))) issues.push('CPF/CNPJ do destinatario invalido.');
  if (!recipient.name && !postal.DESTINATARIO && !postal.NOME) issues.push('Destinatario obrigatorio.');
  const street = String(address.street || postal.ENDERECO || postal['ENDEREÇO'] || '').trim();
  const number = String(address.number || postal.NUMERO || '').trim();
  const district = String(address.district || postal.BAIRRO || '').trim();
  const city = String(address.city || postal.CIDADE || '').trim();
  const uf = String(address.uf || postal.UF || '').toUpperCase();
  const zip = digits_(address.zip || postal.CEP);
  if (!street || !number || !district || !city) issues.push('Endereco do destinatario incompleto.');
  if (!/^\d{8}$/.test(zip)) issues.push('CEP do destinatario invalido.');
  if (!/^[A-Z]{2}$/.test(uf)) issues.push('UF do destinatario invalida.');
  if (!content) issues.push('Conteudo obrigatorio.');
  if (!(value >= 0.01)) issues.push('Valor declarado deve ser maior ou igual a R$ 0,01.');
  let cityCode = '';
  if (city && /^[A-Z]{2}$/.test(uf)) {
    try { cityCode = digits_(address.cityCode || lookupCityCode_(city, uf)); }
    catch (error) { issues.push(String(error.message || error)); }
  }
  return {
    issues: issues,
    source: {
      reference: String(object.ID),
      trackingCode: String(object.TRACKING_CODE),
      service: String(object.SERVICE),
      recipient: {
        document: document,
        documentType: document.length === 14 ? 'CNPJ' : 'CPF',
        name: String(recipient.name || postal.DESTINATARIO || postal.NOME || '').trim(),
        address: {
          street: street, number: number,
          complement: String(address.complement || postal.COMPLEMENTO || ''),
          district: district, city: city, uf: uf, zip: zip, cityCode: cityCode,
          countryCode: '1058', country: 'BRASIL'
        }
      },
      items: [{ description: content, quantity: 1, unitValue: value, ncm: '' }],
      additionalInfo: String(postal.OBSERVACOES || postal['OBSERVAÇÕES'] || '')
    }
  };
}
function listProductionDce_(userId,payload){const campaignId=String(payload.campaignId||'');requireCampaignAccess_(campaignId,userId);return sheetRows_(getSheet_('PRODUCTION_BATCHES')).filter(r=>String(r.CAMPAIGN_ID)===campaignId&&String(r.DOCUMENT_MODE)==='DCE_AUTHORIZED').map(publicRecord_).reverse();}
function preflightProductionDce_(userId,payload){const campaignId=String(payload.campaignId||''),batchId=String(payload.productionBatchId||'');requireCampaignAccess_(campaignId,userId,['AGENCY_ADMIN']);const batch=productionDceBatch_(campaignId,batchId);if(!batch)throw new Error('Lote de producao nao encontrado.');if(String(batch.DOCUMENT_MODE)!=='DCE_AUTHORIZED')throw new Error('Este lote nao usa DC-e autorizada.');const objects=productionDceObjects_(campaignId,batchId);if(!objects.length)throw new Error('Nenhum objeto associado ao lote.');const checked=objects.map(o=>({object:o,result:buildProductionDceSource_(o)})),issues=checked.filter(x=>x.result.issues.length).map(x=>({trackingCode:String(x.object.TRACKING_CODE),issues:x.result.issues}));if(issues.length)return{ready:false,total:objects.length,issues:issues};updateRow_('PRODUCTION_BATCHES',batch._rowNumber,{STATUS:'DCE_PREPARED',UPDATED_AT:nowIso_()});recordOperationEvent_(userId,{campaignId:campaignId,type:'DCE_PREPARED',quantity:objects.length,sourceType:'PRODUCTION_BATCH',sourceId:batchId,idempotencyKey:'dce-preflight:'+batchId,metadata:{status:'DCE_PREPARED'}});return{ready:true,total:objects.length,issues:[]};}
function reserveProductionDce_(userId,payload){const campaignId=String(payload.campaignId||''),batchId=String(payload.productionBatchId||'');requireCampaignAccess_(campaignId,userId);const batch=productionDceBatch_(campaignId,batchId);if(!batch)throw new Error('Lote DC-e nao encontrado.');if(String(batch.DOCUMENT_MODE)!=='DCE_AUTHORIZED')throw new Error('Lote nao configurado para DC-e.');if(String(batch.DCE_BATCH_ID||'')){if(String(batch.DCE_USER_ID)!==String(userId))throw new Error('Este lote ja foi reservado por outro usuario.');return getBatch_(userId,{batchId:String(batch.DCE_BATCH_ID)});}if(String(batch.STATUS)!=='DCE_PREPARED')throw new Error('A agencia ainda nao liberou este lote para autorizacao.');const company=getCompany_(userId);if(!company)throw new Error('Preencha o Perfil fiscal antes de autorizar.');const campaign=getCampaign_(userId,{campaignId:campaignId});if(campaign.cnpj&&digits_(campaign.cnpj).slice(0,8)!==digits_(company.cnpj).slice(0,8))throw new Error('O CNPJ-base do Perfil fiscal nao corresponde a operacao.');const objects=productionDceObjects_(campaignId,batchId),now=nowIso_(),remittanceIds=[];objects.forEach(o=>{const built=buildProductionDceSource_(o);if(built.issues.length)throw new Error('O objeto '+o.TRACKING_CODE+' possui pendencias fiscais: '+built.issues.join(' '));const existing=findRow_('REMITTANCES',r=>String(r.USER_ID)===String(userId)&&String(r.REFERENCE)===String(o.ID));if(existing){if(String(existing.STATUS)!=='READY')throw new Error('Remessa fiscal ja existe em estado '+existing.STATUS+'.');remittanceIds.push(String(existing.ID));return;}const id=uuid_();appendObjects_('REMITTANCES',[{ID:id,USER_ID:userId,IMPORT_ID:'PRODUCTION:'+batchId,TRACKING_CODE:String(o.TRACKING_CODE),SERVICE:String(o.SERVICE),REFERENCE:String(o.ID),STATUS:'READY',DOCUMENT_JSON:built.source,ERRORS_JSON:[],CREATED_AT:now,UPDATED_AT:now}]);remittanceIds.push(id)});const reserved=prepareBatch_(userId,{remittanceIds:remittanceIds,environment:String(payload.environment)==='1'?'1':'2'});updateRow_('PRODUCTION_BATCHES',batch._rowNumber,{STATUS:'DCE_RESERVED',DCE_USER_ID:userId,DCE_BATCH_ID:reserved.id,DCE_AUTHORIZED:0,DCE_REJECTED:0,DCE_ERRORS:0,UPDATED_AT:nowIso_()});return reserved;}
function syncProductionDceResults_(userId,payload){const campaignId=String(payload.campaignId||''),batchId=String(payload.productionBatchId||'');requireCampaignAccess_(campaignId,userId);const batch=productionDceBatch_(campaignId,batchId);if(!batch||!batch.DCE_BATCH_ID)throw new Error('Lote fiscal ainda nao reservado.');if(String(batch.DCE_USER_ID)!==String(userId))throw new Error('Este lote pertence a outro usuario.');const fiscal=findRow_('BATCHES',r=>String(r.ID)===String(batch.DCE_BATCH_ID)&&String(r.USER_ID)===String(userId));if(!fiscal)throw new Error('Lote fiscal nao localizado.');const dces=rowsForUser_('DCE',userId).filter(r=>String(r.BATCH_ID)===String(fiscal.ID)),remittances=rowsForUser_('REMITTANCES',userId);let authorized=0,rejected=0,errors=0;dces.forEach(d=>{const s=String(d.STATUS);if(s==='AUTHORIZED')authorized++;else if(s==='REJECTED')rejected++;else if(['ERROR','INVALID'].indexOf(s)!==-1)errors++;const rem=remittances.find(r=>String(r.ID)===String(d.REMITTANCE_ID));if(!rem)return;const objectId=String(rem.REFERENCE||'');const object=findRow_('POSTAL_OBJECTS',r=>String(r.ID)===objectId&&String(r.CAMPAIGN_ID)===campaignId);if(object)updateRow_('POSTAL_OBJECTS',object._rowNumber,{ACCESS_KEY:String(d.ACCESS_KEY||''),PROTOCOL:String(d.PROTOCOL||''),STATUS:s==='AUTHORIZED'?'DCE_AUTHORIZED':String(object.STATUS||''),UPDATED_AT:nowIso_()});});const total=dces.length,status=authorized===total&&total>0?'READY_FOR_UNIFIED_LABEL':(authorized+rejected+errors>0?'DCE_PARTIAL':'DCE_RESERVED');updateRow_('PRODUCTION_BATCHES',batch._rowNumber,{STATUS:status,DCE_AUTHORIZED:authorized,DCE_REJECTED:rejected,DCE_ERRORS:errors,UPDATED_AT:nowIso_()});if(status==='READY_FOR_UNIFIED_LABEL')recordVerifiedDceAuthorized_(userId,campaignId,batchId,authorized);return{id:batchId,status:status,total:total,authorized:authorized,rejected:rejected,errors:errors};}
