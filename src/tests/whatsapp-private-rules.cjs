/* eslint-disable no-console */
// Standalone SDK/rules regression. Owned demo Firestore only; never production.
const fs=require('node:fs'),path=require('node:path');
const { initializeTestEnvironment, assertFails }=require('@firebase/rules-unit-testing');
const { doc, collection, query, where, getDoc, getDocs, setDoc }=require('firebase/firestore');
const projectId='demo-pediturno-whatsapp-private-rules';
async function main(){
  if(process.env.GCLOUD_PROJECT!==projectId||!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Owned demo rules emulator required');
  const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const env=await initializeTestEnvironment({projectId,firestore:{host,port:Number(port),rules:fs.readFileSync(path.resolve(__dirname,'../../firestore.rules'),'utf8')}});
  const owner='synthetic-owner',names=['whatsappReminderSettings','whatsappReminderConsents','whatsappReminderConsentEvents','whatsappReminderOutbox'];
  const checks=[];
  try{
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async context=>{for(const name of names)await setDoc(doc(context.firestore(),name,owner),{businessId:owner,marker:'synthetic-private-record'});});
    for(const [actor,db] of [['anonymous',env.unauthenticatedContext().firestore()],['owner',env.authenticatedContext(owner).firestore()],['foreign',env.authenticatedContext('synthetic-other').firestore()]]){
      for(const name of names){
        await assertFails(getDoc(doc(db,name,owner)));checks.push({actor,collection:name,operation:'read',denied:true});
        await assertFails(setDoc(doc(db,name,owner),{businessId:owner,enabled:true}));checks.push({actor,collection:name,operation:'write',denied:true});
        await assertFails(getDocs(query(collection(db,name),where('businessId','==',owner))));checks.push({actor,collection:name,operation:'query',denied:true});
      }
    }
    const result={at:new Date().toISOString(),projectId,passed:true,checks,denials:checks.length,productionWrites:0};
    if(process.env.QA_RULES_OUTPUT)fs.writeFileSync(process.env.QA_RULES_OUTPUT,JSON.stringify(result,null,2));
    console.log(JSON.stringify({privateRulesPassed:true,denials:checks.length,productionWrites:0}));
  }finally{await env.cleanup();}
}
main().catch(()=>{console.error('Private collection isolation failed; no production access used');process.exitCode=1;});
