'use strict';
const sdk = require('indy-sdk');
const indy = require('../../index.js');
const config = require('../../../config');
let endpointDid;
let publicVerkey;
let stewardDid;
let stewardKey;
let stewardWallet;
let personIdCredDefId;
let schoolIdCredDefId;
let whsIdCredDefId

exports.createDid = async function (didInfoParam) {
    let didInfo = didInfoParam || {};
    return await sdk.createAndStoreMyDid(await indy.wallet.get(), didInfo);
};

exports.getEndpointDid = async function() {
    if(!endpointDid) {
        let dids = await sdk.listMyDidsWithMeta(await indy.wallet.get());
        for (let didinfo of dids) {
            let meta = JSON.parse(didinfo.metadata);
            if (meta && meta.primary) {
                endpointDid = didinfo.did;
            }
        }
        if(!endpointDid) {
            await exports.createEndpointDid();
        }
    }
    return endpointDid;
};

exports.createEndpointDid = async function () {
    await setupSteward();

    [endpointDid, publicVerkey] = await sdk.createAndStoreMyDid(await indy.wallet.get(), {});
    let didMeta = JSON.stringify({
        primary: true,
        schemas: [],
        credential_definitions: []
    });
    await sdk.setDidMetadata(await indy.wallet.get(), endpointDid, didMeta);

    await indy.pool.sendNym(await indy.pool.get(), stewardWallet, stewardDid, endpointDid, publicVerkey, "TRUST_ANCHOR");
    await indy.pool.setEndpointForDid(endpointDid, config.endpointDidEndpoint);
    await indy.crypto.createMasterSecret();

    await issuePersonIdCredential();
    await issueSchoolIdCredential();
    await issueWhsIdCredential();
    await issueIfisIdCredential();
    await issueSwhIdCredential();

};

exports.setEndpointDidAttribute = async function (attribute, item) {
    let metadata = await sdk.getDidMetadata(await indy.wallet.get(), endpointDid);
    metadata = JSON.parse(metadata);
    metadata[attribute] = item;
    await sdk.setDidMetadata(await indy.wallet.get(), endpointDid, JSON.stringify(metadata));
};


exports.pushEndpointDidAttribute = async function (attribute, item) {
    let metadata = await sdk.getDidMetadata(await indy.wallet.get(), endpointDid);
    metadata = JSON.parse(metadata);
    if (!metadata[attribute]) {
        metadata[attribute] = [];
    }
    metadata[attribute].push(item);
    await sdk.setDidMetadata(await indy.wallet.get(), endpointDid, JSON.stringify(metadata));
};

exports.getEndpointDidAttribute = async function (attribute) {
    let metadata = await sdk.getDidMetadata(await indy.wallet.get(), endpointDid);
    metadata = JSON.parse(metadata);
    return metadata[attribute];
};

exports.getTheirEndpointDid = async function (theirDid) {
    let pairwise = await sdk.getPairwise(await indy.wallet.get(), theirDid);
    let metadata = JSON.parse(pairwise.metadata);
    return metadata.theirEndpointDid;
};

async function setupSteward() {
    let stewardWalletName = `stewardWalletFor:${config.walletName}`;
    try {
        await sdk.createWallet({id: stewardWalletName}, {key: 'whatever'});
    } catch (e) {
        if (e.message !== 'WalletAlreadyExistsError') {
            console.warn('create wallet failed with message: ' + e.message);
            throw e;
        }
    } finally {
        console.info('wallet already exist, try to open wallet');
    }

    stewardWallet = await sdk.openWallet(
        {id: stewardWalletName},
        {key: 'whatever'}
    );

    let stewardDidInfo = {
        'seed': '000000000000000000000000Steward1'
    };

    [stewardDid, stewardKey] = await sdk.createAndStoreMyDid(stewardWallet, stewardDidInfo);

}

async function issuePersonIdCredential() {
    let schemaName = 'Person-ID';
    let schemaVersion = '1.2';
    let signatureType = 'CL';
    let personIdSchema;
    let personIdSchemaId = `${stewardDid}:2:${schemaName}:${schemaVersion}`;
    
    try {
        personIdSchema = await indy.issuer.getSchema(personIdSchemaId);
    } catch(e) {
        [personIdSchemaId, personIdSchema] = await sdk.issuerCreateSchema(stewardDid, schemaName, schemaVersion, [
            'name',
            'geburtstag',
            'geburtsort',
            'anschrift'
        ]);
        await indy.issuer.sendSchema(await indy.pool.get(), stewardWallet, stewardDid, personIdSchema);
        personIdSchema = await indy.issuer.getSchema(personIdSchemaId);
    }
   
    let personIdCredDef;
    [personIdCredDefId, personIdCredDef] = await sdk.issuerCreateAndStoreCredentialDef(stewardWallet, stewardDid,
         personIdSchema, 'PID', signatureType, '{"support_revocation": false}');

    await indy.issuer.sendCredDef(await indy.pool.get(), stewardWallet, stewardDid, personIdCredDef);
    
    exports.setEndpointDidAttribute('PIDCredDefId', personIdCredDefId);

    
    let personIdCredOffer = await sdk.issuerCreateCredentialOffer(stewardWallet, personIdCredDefId);
    let [personIdCredRequest, personIdRequestMetadata] = await sdk.proverCreateCredentialReq(await indy.wallet.get(), 
        endpointDid, personIdCredOffer, personIdCredDef, await indy.did.getEndpointDidAttribute('master_secret_id'));


    let personIdValues = {
            name: { "raw": config.userInformation.name, "encoded": indy.credentials.encode(config.userInformation.name) },       
            geburtstag: {"raw": config.userInformation.geburtstag, "encoded": indy.credentials.encode(config.userInformation.geburtstag)},
            geburtsort: {"raw": config.userInformation.geburtsort, "encoded": indy.credentials.encode(config.userInformation.geburtsort)},
            anschrift: { "raw": config.userInformation.anschrift, "encoded": indy.credentials.encode(config.userInformation.anschrift) }
    };

    let [personIdCredential] = await sdk.issuerCreateCredential(stewardWallet, personIdCredOffer, personIdCredRequest, personIdValues);
    let res = await sdk.proverStoreCredential(await indy.wallet.get(), null, personIdRequestMetadata, personIdCredential, personIdCredDef);
    console.log("PersonID: ", await indy.did.getPersonIdCredDefId());
}
///////////////////////////////////////////////////////////////////////////////////////////////////////
async function issueSchoolIdCredential() {
    let schemaName = 'School-ID';
    let schemaVersion = '1.0';
    let signatureType = 'CL';
    let schoolIdSchema;
    let schoolIdSchemaId = `${stewardDid}:2:${schemaName}:${schemaVersion}`;
    

    try {
        schoolIdSchema = await indy.issuer.getSchema(schoolIdSchemaId);
    } catch(e) {
        [schoolIdSchemaId, schoolIdSchema] = await sdk.issuerCreateSchema(stewardDid, schemaName, schemaVersion, [
            'name',
            'geburtstag',
            'schule',
            'abschluss',
            'durchschnitt'
        ]);
        await indy.issuer.sendSchema(await indy.pool.get(), stewardWallet, stewardDid, schoolIdSchema);
        schoolIdSchema = await indy.issuer.getSchema(schoolIdSchemaId);
    }
    
    let schoolIdCredDef;
    [schoolIdCredDefId, schoolIdCredDef] = await sdk.issuerCreateAndStoreCredentialDef(stewardWallet, stewardDid, schoolIdSchema, 'SID', signatureType, '{"support_revocation": false}');
    await indy.issuer.sendCredDef(await indy.pool.get(), stewardWallet, stewardDid, schoolIdCredDef);
    
    exports.setEndpointDidAttribute('SIDSchemaName', schemaName);

    if (config.userInformation.name == "Alice White") {
        let schoolIdCredOffer = await sdk.issuerCreateCredentialOffer(stewardWallet, schoolIdCredDefId);
        let [schoolIdCredRequest, schoolIdRequestMetadata] = await sdk.proverCreateCredentialReq(await indy.wallet.get(), endpointDid, schoolIdCredOffer, schoolIdCredDef, await indy.did.getEndpointDidAttribute('master_secret_id'));

        let schoolIdValues = {
                name: { "raw": config.userInformation.name, "encoded": indy.credentials.encode(config.userInformation.name) },      
                geburtstag: {"raw": config.userInformation.geburtstag, "encoded": indy.credentials.encode(config.userInformation.geburtstag)},
                schule: {"raw": config.userInformation.schule, "encoded": indy.credentials.encode(config.userInformation.schule)},
                abschluss: { "raw": config.userInformation.abschluss, "encoded": indy.credentials.encode(config.userInformation.abschluss)},
                durchschnitt: { "raw": config.userInformation.durchschnitt, "encoded": indy.credentials.encode(config.userInformation.durchschnitt)},
        };

        let [schoolIdCredential] = await sdk.issuerCreateCredential(stewardWallet, schoolIdCredOffer, schoolIdCredRequest, schoolIdValues);
        let res = await sdk.proverStoreCredential(await indy.wallet.get(), null, schoolIdRequestMetadata, schoolIdCredential, schoolIdCredDef);
        
    }
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
async function issueWhsIdCredential() {    
    let schemaName = 'WHS-ID';
    let schemaVersion = '1.0';
    let signatureType = 'CL';
    let whsIdSchema;
    let whsIdSchemaId = `${stewardDid}:2:${schemaName}:${schemaVersion}`;
    

    try {
        whsIdSchema = await indy.issuer.getSchema(whsIdSchemaId);
    } catch(e) {
        [whsIdSchemaId, whsIdSchema] = await sdk.issuerCreateSchema(stewardDid, schemaName, schemaVersion, [
            'name',
            'hochschule',
            'studiengang',
            'matrikelnummer',
        ]);
        await indy.issuer.sendSchema(await indy.pool.get(), stewardWallet, stewardDid, whsIdSchema);
        whsIdSchema = await indy.issuer.getSchema(whsIdSchemaId);
    }
    //worked
    await indy.issuer.createCredDef(whsIdSchemaId, 'WID');

    console.log("WhsID: ", (await indy.issuer.getCredDefByTag("WID")).id);
    
}    
////////////////////////////////////////////////////////////////////////////////////////////////////
async function issueIfisIdCredential() {    
    let schemaName = 'IFIS-ID';
    let schemaVersion = '1.0';
    let signatureType = 'CL';
    let ifisIdSchema;
    let ifisIdSchemaId = `${stewardDid}:2:${schemaName}:${schemaVersion}`;
    

    try {
        ifisIdSchema = await indy.issuer.getSchema(ifisIdSchemaId);
    } catch(e) {
        [ifisIdSchemaId, ifisIdSchema] = await sdk.issuerCreateSchema(stewardDid, schemaName, schemaVersion, [
            'name',
            'arbeitgeber',
            'gehalt',
            'vertragsart',
        ]);
        await indy.issuer.sendSchema(await indy.pool.get(), stewardWallet, stewardDid, ifisIdSchema);
        ifisIdSchema = await indy.issuer.getSchema(ifisIdSchemaId);
    }
    await indy.issuer.createCredDef(ifisIdSchemaId, 'IFISID');

    console.log("IFISID: ", (await indy.issuer.getCredDefByTag("IFISID")).id);
    
}    
////////////////////////////////////////////////////////////////////////////////////////////////////

async function issueSwhIdCredential() {    
    let schemaName = 'Swh-ID';
    let schemaVersion = '1.2';
    let signatureType = 'CL';
    let swhIdSchema;
    let swhIdSchemaId = `${stewardDid}:2:${schemaName}:${schemaVersion}`;
    

    try {
        swhIdSchema = await indy.issuer.getSchema(swhIdSchemaId);
    } catch(e) {
        [swhIdSchemaId, swhIdSchema] = await sdk.issuerCreateSchema(stewardDid, schemaName, schemaVersion, [
            'name',
            'zimmernummer',
            'miete',
            'anschrift',
        ]);
        await indy.issuer.sendSchema(await indy.pool.get(), stewardWallet, stewardDid, swhIdSchema);
        swhIdSchema = await indy.issuer.getSchema(swhIdSchemaId);
    }
    await indy.issuer.createCredDef(swhIdSchemaId, 'SWHID');

    console.log("IFISID: ", (await indy.issuer.getCredDefByTag("SWHID")).id);
    
}    
////////////////////////////////////////////////////////////////////////////////////////////////////
exports.getPersonIdCredDefId = async function() {
    return await exports.getEndpointDidAttribute('PIDCredDefId');
};
exports.getSchoolSchemaName = async function() {
    return await exports.getEndpointDidAttribute('SIDSchemaName');
};
exports.getWhsIdCredDefId = async function() {
    return await exports.getEndpointDidAttribute('WHSCredDefId');
};
exports.getStewardWallet = async function() {
    return stewardWallet;
}
