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

    await issuePersonernmentIdCredential();
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

async function issuePersonernmentIdCredential() {
    let schemaName = 'Person-ID';
    let schemaVersion = '1.2';
    let signatureType = 'CL';
    let personIdSchema;
    let personIdSchemaId = `${stewardDid}:2:${schemaName}:${schemaVersion}`;
    

    try {
        personIdSchema = await indy.issuer.getSchema(personIdSchemaId);
    } catch(e) {
        [personIdSchemaId, personIdSchema] = await sdk.issuerCreateSchema(stewardDid, schemaName, schemaVersion, [
            'a_Name',
            'b_Vorname',
            'c_Geburtstag',
            'd_Geburtsort',
            'e_Anschrift'
        ]);
        await indy.issuer.sendSchema(await indy.pool.get(), stewardWallet, stewardDid, personIdSchema);
        personIdSchema = await indy.issuer.getSchema(personIdSchemaId);
    }
    console.log(JSON.stringify(personIdSchema));


    let personIdCredDef;
    [personIdCredDefId, personIdCredDef] = await sdk.issuerCreateAndStoreCredentialDef(stewardWallet, stewardDid, personIdSchema, 'PID', signatureType, '{"support_revocation": false}');
    await indy.issuer.sendCredDef(await indy.pool.get(), stewardWallet, stewardDid, personIdCredDef);
    console.log("This is the personIdCredDefId" + personIdCredDefId);
    exports.setEndpointDidAttribute('PIDCredDefId', personIdCredDefId);


    let personIdCredOffer = await sdk.issuerCreateCredentialOffer(stewardWallet, personIdCredDefId);
    let [personIdCredRequest, personIdRequestMetadata] = await sdk.proverCreateCredentialReq(await indy.wallet.get(), endpointDid, personIdCredOffer, personIdCredDef, await indy.did.getEndpointDidAttribute('master_secret_id'));

    console.log("???????????????????????????????????????");
    console.log(config.userInformation.address);

    let personIdValues = {
            a_Name: { "raw": config.userInformation.name, "encoded": indy.credentials.encode(config.userInformation.name) },
            b_Vorname: {"raw": config.userInformation.vorname, "encoded": indy.credentials.encode(config.userInformation.vorname)},       
            c_Geburtstag: {"raw": config.userInformation.geburtstag, "encoded": indy.credentials.encode(config.userInformation.geburtstag)},
            d_Geburtsort: {"raw": config.userInformation.geburtsort, "encoded": indy.credentials.encode(config.userInformation.geburtsort)},
            e_Anschrift: { "raw": config.userInformation.anschrift, "encoded": indy.credentials.encode(config.userInformation.anschrift) }
    };

    let [personIdCredential] = await sdk.issuerCreateCredential(stewardWallet, personIdCredOffer, personIdCredRequest, personIdValues);
    let res = await sdk.proverStoreCredential(await indy.wallet.get(), null, personIdRequestMetadata, personIdCredential, personIdCredDef);
}

exports.getPersonIdCredDefId = async function() {
    return await exports.getEndpointDidAttribute('PIDCredDefId1');
};
