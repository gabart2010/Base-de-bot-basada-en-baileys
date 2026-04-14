import NodeCache from '@cacheable/node-cache';
import { Boom } from '@hapi/boom';
import { randomBytes } from 'crypto';
import { proto } from '@whiskeysockets/baileys/WAProto/index.js';
import { DEFAULT_CACHE_TTLS, WA_DEFAULT_EPHEMERAL } from '../Defaults/index.js';
import { aggregateMessageKeysNotFromMe, assertMediaContent, bindWaitForEvent, decryptMediaRetryData, encodeNewsletterMessage, encodeSignedDeviceIdentity, encodeWAMessage, encryptMediaRetryRequest, extractDeviceJids, generateMessageIDV2, generateParticipantHashV2, generateWAMessage, generateWAMessageFromContent, prepareWAMessageMedia, getStatusCodeForMediaRetry, getUrlFromDirectPath, getWAUploadToServer, MessageRetryManager, normalizeMessageContent, parseAndInjectE2ESessions, unixTimestampSeconds } from '@whiskeysockets/baileys/lib/Utils/index.js';
import { getUrlInfo } from '@whiskeysockets/baileys/lib/Utils/link-preview.js';
import { makeKeyedMutex } from './make-mutex.js';
import { getMessageReportingToken, shouldIncludeReportingToken } from './reporting-utils.js';
import { areJidsSameUser, getBinaryFilteredBizBot, getBinaryNodeChild, getBinaryNodeChildren, isHostedLidUser, isHostedPnUser, isJidGroup, isJidUser, isLidUser, isPnUser, jidDecode, jidEncode, jidNormalizedUser, S_WHATSAPP_NET, STORIES_JID } from '../WABinary/index.js';
import { delay } from '../Utils/generics.js';
import { USyncQuery, USyncUser } from '../WAUSync/index.js';
import { makeNewsletterSocket } from '../newsletter.js';
const _isNewsletterJid = (jid) => typeof jid === 'string' && jid.endsWith('@newsletter');

export const makeMessagesSocket = (config) => {
    const { logger, linkPreviewImageThumbnailWidth, generateHighQualityLinkPreview, options: httpRequestOptions, patchMessageBeforeSending, cachedGroupMetadata, enableRecentMessageCache, maxMsgRetryCount } = config;
    const sock = makeNewsletterSocket(config);
    const { ev, authState, messageMutex, signalRepository, upsertMessage, query, fetchPrivacySettings, sendNode, groupMetadata, groupToggleEphemeral } = sock;
    const userDevicesCache = config.userDevicesCache ||
        new NodeCache({
            stdTTL: DEFAULT_CACHE_TTLS.USER_DEVICES, // 5 minutes
            useClones: false
        });
    const peerSessionsCache = new NodeCache({
        stdTTL: DEFAULT_CACHE_TTLS.USER_DEVICES,
        useClones: false
    });
    const messageRetryManager = enableRecentMessageCache ? new MessageRetryManager(logger, maxMsgRetryCount) : null;
    const encryptionMutex = makeKeyedMutex();
    let mediaConn;
    const refreshMediaConn = async (forceGet = false) => {
        const media = await mediaConn;
        if (!media || forceGet || new Date().getTime() - media.fetchDate.getTime() > media.ttl * 1000) {
            mediaConn = (async () => {
                const result = await query({
                    tag: 'iq',
                    attrs: {
                        type: 'set',
                        xmlns: 'w:m',
                        to: S_WHATSAPP_NET
                    },
                    content: [{ tag: 'media_conn', attrs: {} }]
                });
                const mediaConnNode = getBinaryNodeChild(result, 'media_conn');
                const node = {
                    hosts: getBinaryNodeChildren(mediaConnNode, 'host').map(({ attrs }) => ({
                        hostname: attrs.hostname,
                        maxContentLengthBytes: +attrs.maxContentLengthBytes
                    })),
                    auth: mediaConnNode.attrs.auth,
                    ttl: +mediaConnNode.attrs.ttl,
                    fetchDate: new Date()
                };
                logger.debug('fetched media conn');
                return node;
            })();
        }
        return mediaConn;
    };
    const sendReceipt = async (jid, participant, messageIds, type) => {
        if (!messageIds || messageIds.length === 0) {
            throw new Boom('missing ids in receipt');
        }
        const node = {
            tag: 'receipt',
            attrs: {
                id: messageIds[0]
            }
        };
        const isReadReceipt = type === 'read' || type === 'read-self';
        if (isReadReceipt) {
            node.attrs.t = unixTimestampSeconds().toString();
        }
        if (type === 'sender' && (isPnUser(jid) || isLidUser(jid))) {
            node.attrs.recipient = jid;
            node.attrs.to = participant;
        }
        else {
            node.attrs.to = jid;
            if (participant) {
                node.attrs.participant = participant;
            }
        }
        if (type) {
            node.attrs.type = type;
        }
        const remainingMessageIds = messageIds.slice(1);
        if (remainingMessageIds.length) {
            node.content = [
                {
                    tag: 'list',
                    attrs: {},
                    content: remainingMessageIds.map(id => ({
                        tag: 'item',
                        attrs: { id }
                    }))
                }
            ];
        }
        logger.debug({ attrs: node.attrs, messageIds }, 'sending receipt for messages');
        await sendNode(node);
    };
    const sendReceipts = async (keys, type) => {
        const recps = aggregateMessageKeysNotFromMe(keys);
        for (const { jid, participant, messageIds } of recps) {
            await sendReceipt(jid, participant, messageIds, type);
        }
    };
    const readMessages = async (keys) => {
        const privacySettings = await fetchPrivacySettings();
        const readType = privacySettings.readreceipts === 'all' ? 'read' : 'read-self';
        await sendReceipts(keys, readType);
    };
    const getUSyncDevices = async (jids, useCache, ignoreZeroDevices) => {
        const deviceResults = [];
        if (!useCache) {
            logger.debug('not using cache for devices');
        }
        const toFetch = [];
        const jidsWithUser = jids
            .map(jid => {
            const decoded = jidDecode(jid);
            const user = decoded?.user;
            const device = decoded?.device;
            const isExplicitDevice = typeof device === 'number' && device >= 0;
            if (isExplicitDevice && user) {
                deviceResults.push({
                    user,
                    device,
                    jid
                });
                return null;
            }
            jid = jidNormalizedUser(jid);
            return { jid, user };
        })
            .filter(jid => jid !== null);
        let mgetDevices;
        if (useCache && userDevicesCache.mget) {
            const usersToFetch = jidsWithUser.map(j => j?.user).filter(Boolean);
            mgetDevices = await userDevicesCache.mget(usersToFetch);
        }
        for (const { jid, user } of jidsWithUser) {
            if (useCache) {
                const devices = mgetDevices?.[user] ||
                    (userDevicesCache.mget ? undefined : (await userDevicesCache.get(user)));
                if (devices) {
                    const devicesWithJid = devices.map(d => ({
                        ...d,
                        jid: jidEncode(d.user, d.server, d.device)
                    }));
                    deviceResults.push(...devicesWithJid);
                    logger.trace({ user }, 'using cache for devices');
                }
                else {
                    toFetch.push(jid);
                }
            }
            else {
                toFetch.push(jid);
            }
        }
        if (!toFetch.length) {
            return deviceResults;
        }
        const requestedLidUsers = new Set();
        for (const jid of toFetch) {
            if (isLidUser(jid) || isHostedLidUser(jid)) {
                const user = jidDecode(jid)?.user;
                if (user)
                    requestedLidUsers.add(user);
            }
        }
        const query = new USyncQuery().withContext('message').withDeviceProtocol().withLIDProtocol();
        for (const jid of toFetch) {
            query.withUser(new USyncUser().withId(jid));
        }
        const result = await sock.executeUSyncQuery(query);
        if (result) {
            const lidResults = result.list.filter(a => !!a.lid);
            if (lidResults.length > 0) {
                logger.trace('Storing LID maps from device call');
                await signalRepository.lidMapping.storeLIDPNMappings(lidResults.map(a => ({ lid: a.lid, pn: a.id })));
                try {
                    const lids = lidResults.map(a => a.lid);
                    if (lids.length) {
                        await assertSessions(lids, true);
                    }
                }
                catch (e) {
                    logger.warn({ e, count: lidResults.length }, 'failed to assert sessions for newly mapped LIDs');
                }
            }
            const extracted = extractDeviceJids(result?.list, authState.creds.me.id, authState.creds.me.lid, ignoreZeroDevices);
            const deviceMap = {};
            for (const item of extracted) {
                deviceMap[item.user] = deviceMap[item.user] || [];
                deviceMap[item.user]?.push(item);
            }
            for (const [user, userDevices] of Object.entries(deviceMap)) {
                const isLidUser = requestedLidUsers.has(user);
                for (const item of userDevices) {
                    const finalJid = isLidUser
                        ? jidEncode(user, item.server, item.device)
                        : jidEncode(item.user, item.server, item.device);
                    deviceResults.push({
                        ...item,
                        jid: finalJid
                    });
                    logger.debug({
                        user: item.user,
                        device: item.device,
                        finalJid,
                        usedLid: isLidUser
                    }, 'Processed device with LID priority');
                }
            }
            if (userDevicesCache.mset) {
                await userDevicesCache.mset(Object.entries(deviceMap).map(([key, value]) => ({ key, value })));
            }
            else {
                for (const key in deviceMap) {
                    if (deviceMap[key])
                        await userDevicesCache.set(key, deviceMap[key]);
                }
            }
            const userDeviceUpdates = {};
            for (const [userId, devices] of Object.entries(deviceMap)) {
                if (devices && devices.length > 0) {
                    userDeviceUpdates[userId] = devices.map(d => d.device?.toString() || '0');
                }
            }
            if (Object.keys(userDeviceUpdates).length > 0) {
                try {
                    await authState.keys.set({ 'device-list': userDeviceUpdates });
                    logger.debug({ userCount: Object.keys(userDeviceUpdates).length }, 'stored user device lists for bulk migration');
                }
                catch (error) {
                    logger.warn({ error }, 'failed to store user device lists');
                }
            }
        }
        return deviceResults;
    };
    const updateMemberLabel = (jid, memberLabel) => {
        return relayMessage(jid, {
            protocolMessage: {
                type: proto.Message.ProtocolMessage.Type.GROUP_MEMBER_LABEL_CHANGE,
                memberLabel: {
                    label: memberLabel?.slice(0, 30),
                    labelTimestamp: unixTimestampSeconds()
                }
            }
        }, {
            additionalNodes: [
                {
                    tag: 'meta',
                    attrs: {
                        tag_reason: 'user_update',
                        appdata: 'member_tag'
                    },
                    content: undefined
                }
            ]
        });
    };
    const assertSessions = async (jids, force) => {
        let didFetchNewSession = false;
        const uniqueJids = [...new Set(jids)];
        const jidsRequiringFetch = [];
        logger.debug({ jids }, 'assertSessions call with jids');
        for (const jid of uniqueJids) {
            const signalId = signalRepository.jidToSignalProtocolAddress(jid);
            const cachedSession = peerSessionsCache.get(signalId);
            if (cachedSession !== undefined) {
                if (cachedSession && !force) {
                    continue;
                }
            }
            else {
                const sessionValidation = await signalRepository.validateSession(jid);
                const hasSession = sessionValidation.exists;
                peerSessionsCache.set(signalId, hasSession);
                if (hasSession && !force) {
                    continue;
                }
            }
            jidsRequiringFetch.push(jid);
        }
        if (jidsRequiringFetch.length) {
            const wireJids = [
                ...jidsRequiringFetch.filter(jid => !!isLidUser(jid) || !!isHostedLidUser(jid)),
                ...((await signalRepository.lidMapping.getLIDsForPNs(jidsRequiringFetch.filter(jid => !!isPnUser(jid) || !!isHostedPnUser(jid)))) || []).map(a => a.lid)
            ];
            logger.debug({ jidsRequiringFetch, wireJids }, 'fetching sessions');
            const result = await query({
                tag: 'iq',
                attrs: {
                    xmlns: 'encrypt',
                    type: 'get',
                    to: S_WHATSAPP_NET
                },
                content: [
                    {
                        tag: 'key',
                        attrs: {},
                        content: wireJids.map(jid => {
                            const attrs = { jid };
                            if (force)
                                attrs.reason = 'identity';
                            return { tag: 'user', attrs };
                        })
                    }
                ]
            });
            await parseAndInjectE2ESessions(result, signalRepository);
            didFetchNewSession = true;
            for (const wireJid of wireJids) {
                const signalId = signalRepository.jidToSignalProtocolAddress(wireJid);
                peerSessionsCache.set(signalId, true);
            }
        }
        return didFetchNewSession;
    };
    const sendPeerDataOperationMessage = async (pdoMessage) => {
        if (!authState.creds.me?.id) {
            throw new Boom('Not authenticated');
        }
        const protocolMessage = {
            protocolMessage: {
                peerDataOperationRequestMessage: pdoMessage,
                type: proto.Message.ProtocolMessage.Type.PEER_DATA_OPERATION_REQUEST_MESSAGE
            }
        };
        const meJid = jidNormalizedUser(authState.creds.me.id);
        const msgId = await relayMessage(meJid, protocolMessage, {
            additionalAttributes: {
                category: 'peer',
                push_priority: 'high_force'
            },
            additionalNodes: [
                {
                    tag: 'meta',
                    attrs: { appdata: 'default' }
                }
            ]
        });
        return msgId;
    };
    const createParticipantNodes = async (recipientJids, message, extraAttrs, dsmMessage) => {
        if (!recipientJids.length) {
            return { nodes: [], shouldIncludeDeviceIdentity: false };
        }
        const patched = await patchMessageBeforeSending(message, recipientJids);
        const patchedMessages = Array.isArray(patched)
            ? patched
            : recipientJids.map(jid => ({ recipientJid: jid, message: patched }));
        let shouldIncludeDeviceIdentity = false;
        const meId = authState.creds.me.id;
        const meLid = authState.creds.me?.lid;
        const meLidUser = meLid ? jidDecode(meLid)?.user : null;
        const encryptionPromises = patchedMessages.map(async ({ recipientJid: jid, message: patchedMessage }) => {
            try {
                if (!jid)
                    return null;
                let msgToEncrypt = patchedMessage;
                if (dsmMessage) {
                    const { user: targetUser } = jidDecode(jid);
                    const { user: ownPnUser } = jidDecode(meId);
                    const ownLidUser = meLidUser;
                    const isOwnUser = targetUser === ownPnUser || (ownLidUser && targetUser === ownLidUser);
                    const isExactSenderDevice = jid === meId || (meLid && jid === meLid);
                    if (isOwnUser && !isExactSenderDevice) {
                        msgToEncrypt = dsmMessage;
                        logger.debug({ jid, targetUser }, 'Using DSM for own device');
                    }
                }
                const bytes = encodeWAMessage(msgToEncrypt);
                const mutexKey = jid;
                const node = await encryptionMutex.mutex(mutexKey, async () => {
                    const { type, ciphertext } = await signalRepository.encryptMessage({ jid, data: bytes });
                    if (type === 'pkmsg') {
                        shouldIncludeDeviceIdentity = true;
                    }
                    return {
                        tag: 'to',
                        attrs: { jid },
                        content: [
                            {
                                tag: 'enc',
                                attrs: { v: '2', type, ...(extraAttrs || {}) },
                                content: ciphertext
                            }
                        ]
                    };
                });
                return node;
            }
            catch (err) {
                logger.error({ jid, err }, 'Failed to encrypt for recipient');
                return null;
            }
        });
        const nodes = (await Promise.all(encryptionPromises)).filter(node => node !== null);
        if (recipientJids.length > 0 && nodes.length === 0) {
            throw new Boom('All encryptions failed', { statusCode: 500 });
        }
        return { nodes, shouldIncludeDeviceIdentity };
    };
    const relayMessage = async (jid, message, { messageId: msgId, participant, additionalAttributes, additionalNodes, useUserDevicesCache, useCachedGroupMetadata, statusJidList, AI = false }) => {
        const meId = authState.creds.me.id;
        const meLid = authState.creds.me?.lid;
        const isRetryResend = Boolean(participant?.jid);
        let shouldIncludeDeviceIdentity = isRetryResend;
        const statusJid = 'status@broadcast';
        const { user, server } = jidDecode(jid);
        const isGroup = server === 'g.us';
        const isStatus = jid === statusJid;
        const isLid = server === 'lid';
        const isNewsletter = server === 'newsletter';
        const isGroupOrStatus = isGroup || isStatus;
        const finalJid = jid;
        msgId = msgId || generateMessageIDV2(meId);
        useUserDevicesCache = useUserDevicesCache !== false;
        useCachedGroupMetadata = useCachedGroupMetadata !== false && !isStatus;
        const participants = [];
        const destinationJid = !isStatus ? finalJid : statusJid;
        const binaryNodeContent = [];
        const devices = [];
        let reportingMessage;
        const meMsg = {
            deviceSentMessage: {
                destinationJid,
                message
            },
            messageContextInfo: message.messageContextInfo
        };
        const extraAttrs = {};
        if (participant) {
            if (!isGroup && !isStatus) {
                additionalAttributes = { ...additionalAttributes, device_fanout: 'false' };
            }
            const { user, device } = jidDecode(participant.jid);
            devices.push({
                user,
                device,
                jid: participant.jid
            });
        }
        await authState.keys.transaction(async () => {
            const mediaType = getMediaType(message);
            if (mediaType) {
                extraAttrs['mediatype'] = mediaType;
            }
            if (isNewsletter) {
                if (message.protocolMessage?.editedMessage) {
                    msgId = message.protocolMessage.key?.id;
                    message = message.protocolMessage.editedMessage;
                }
                if (message.protocolMessage?.type === proto.Message.ProtocolMessage.Type.REVOKE) {
                    msgId = message.protocolMessage.key?.id;
                    message = {};
                }
                if (message.listMessage) {
                    const list = message.listMessage;
                    message = {
                        interactiveMessage: {
                            nativeFlowMessage: {
                                buttons: [{
                                    name: 'single_select',
                                    buttonParamsJson: JSON.stringify({
                                        title: list.buttonText || 'Select',
                                        sections: (list.sections || []).map(sec => ({
                                            title: sec.title || '',
                                            highlight_label: '',
                                            rows: (sec.rows || []).map(row => ({
                                                header: '',
                                                title: row.title || '',
                                                description: row.description || '',
                                                id: row.rowId || row.id || ''
                                            }))
                                        }))
                                    })
                                }],
                                messageParamsJson: '',
                                messageVersion: 1
                            },
                            body: { text: list.description || '' },
                            ...(list.footerText ? { footer: { text: list.footerText } } : {}),
                            ...(list.title ? { header: { title: list.title, hasMediaAttachment: false, subtitle: '' } } : {})
                        }
                    };
                }
                else if (message.buttonsMessage) {
                    const bMsg = message.buttonsMessage;
                    message = {
                        interactiveMessage: {
                            nativeFlowMessage: {
                                buttons: (bMsg.buttons || []).map(btn => ({
                                    name: 'quick_reply',
                                    buttonParamsJson: JSON.stringify({
                                        display_text: btn.buttonText?.displayText || btn.buttonText || '',
                                        id: btn.buttonId || btn.buttonText?.displayText || ''
                                    })
                                })),
                                messageParamsJson: '',
                                messageVersion: 1
                            },
                            body: { text: bMsg.contentText || bMsg.text || '' },
                            ...(bMsg.footerText ? { footer: { text: bMsg.footerText } } : {}),
                        }
                    };
                }
                const patched = patchMessageBeforeSending ? await patchMessageBeforeSending(message, []) : message;
                if (Array.isArray(patched)) {
                    throw new Error('Per-jid patching is not supported in channel');
                }
                const bytes = encodeNewsletterMessage(patched);
                if (patched.interactiveMessage && !extraAttrs['mediatype']) {
                    extraAttrs['mediatype'] = 'interactive';
                }
                binaryNodeContent.push({
                    tag: 'plaintext',
                    attrs: extraAttrs,
                    content: bytes
                });
                logger.debug({ msgId, extraAttrs }, `sending newsletter message to ${jid}`);
                logger.debug({ additionalAttributes }, 'newsletter stanza attrs');
                const stanza = {
                    tag: 'message',
                    attrs: {
                        to: jid,
                        id: msgId,
                        type: getMessageType(message),
                        ...(additionalAttributes || {})
                    },
                    content: binaryNodeContent
                };
                await sendNode(stanza);
                return;
            }
            if (normalizeMessageContent(message)?.pinInChatMessage || normalizeMessageContent(message)?.reactionMessage) {
                extraAttrs['decrypt-fail'] = 'hide';
            }
            if (isGroupOrStatus && !isRetryResend) {
                const [groupData, senderKeyMap] = await Promise.all([
                    (async () => {
                        let groupData = useCachedGroupMetadata && cachedGroupMetadata ? await cachedGroupMetadata(jid) : undefined;
                        if (groupData && Array.isArray(groupData?.participants)) {
                            logger.trace({ jid, participants: groupData.participants.length }, 'using cached group metadata');
                        }
                        else if (!isStatus) {
                            groupData = await groupMetadata(jid);
                        }
                        return groupData;
                    })(),
                    (async () => {
                        if (!participant && !isStatus) {
                            const result = await authState.keys.get('sender-key-memory', [jid]);
                            return result[jid] || {};
                        }
                        return {};
                    })()
                ]);
                const participantsList = groupData ? groupData.participants.map(p => p.id) : [];
                if (groupData?.ephemeralDuration && groupData.ephemeralDuration > 0) {
                    additionalAttributes = {
                        ...additionalAttributes,
                        expiration: groupData.ephemeralDuration.toString()
                    };
                }
                if (isStatus && statusJidList) {
                    participantsList.push(...statusJidList);
                }
                const additionalDevices = await getUSyncDevices(participantsList, !!useUserDevicesCache, false);
                devices.push(...additionalDevices);
                if (isGroup) {
                    additionalAttributes = {
                        ...additionalAttributes,
                        addressing_mode: groupData?.addressingMode || 'lid'
                    };
                }
                if (message?.groupStatusMessageV2 && !message?.messageContextInfo?.messageSecret) {
                    const { randomBytes } = await import('node:crypto');
                    message = {
                        ...message,
                        messageContextInfo: {
                            ...(message.messageContextInfo || {}),
                            messageSecret: randomBytes(32)
                        },
                        groupStatusMessageV2: {
                            ...message.groupStatusMessageV2,
                            message: {
                                ...(message.groupStatusMessageV2.message || {}),
                                messageContextInfo: {
                                    ...(message.groupStatusMessageV2.message?.messageContextInfo || {}),
                                    messageSecret: message.messageContextInfo?.messageSecret || randomBytes(32)
                                }
                            }
                        }
                    };
                }
                if (message.listMessage) {
                    const list = message.listMessage;
                    const interactiveMessage = {
                        nativeFlowMessage: {
                            buttons: [{
                                name: 'single_select',
                                buttonParamsJson: JSON.stringify({
                                    title: list.buttonText || 'Select',
                                    sections: (list.sections || []).map(section => ({
                                        title: section.title || '',
                                        highlight_label: '',
                                        rows: (section.rows || []).map(row => ({
                                            header: '',
                                            title: row.title || '',
                                            description: row.description || '',
                                            id: row.rowId || row.id || ''
                                        }))
                                    }))
                                })
                            }],
                            messageParamsJson: '',
                            messageVersion: 1
                        },
                        body: { text: list.description || '' },
                        footer: list.footerText ? { text: list.footerText } : undefined,
                        header: list.title ? { title: list.title, hasMediaAttachment: false, subtitle: '' } : undefined,
                        contextInfo: list.contextInfo
                    };
                    message = { interactiveMessage };
                }
                else if (message.buttonsMessage) {
                    const bMsg = message.buttonsMessage;
                    const buttons = (bMsg.buttons || []).map(btn => ({
                        name: 'quick_reply',
                        buttonParamsJson: JSON.stringify({
                            display_text: btn.buttonText?.displayText || btn.buttonText || '',
                            id: btn.buttonId || btn.buttonText?.displayText || ''
                        })
                    }));
                    const interactiveMessage = {
                        nativeFlowMessage: {
                            buttons,
                            messageParamsJson: '',
                            messageVersion: 1
                        },
                        body: { text: bMsg.contentText || bMsg.text || '' },
                        footer: bMsg.footerText ? { text: bMsg.footerText } : undefined,
                        header: bMsg.text
                            ? { title: bMsg.text, hasMediaAttachment: false, subtitle: '' }
                            : (bMsg.imageMessage || bMsg.videoMessage || bMsg.documentMessage
                                ? { hasMediaAttachment: true, ...(bMsg.imageMessage ? { imageMessage: bMsg.imageMessage } : {}), ...(bMsg.videoMessage ? { videoMessage: bMsg.videoMessage } : {}) }
                                : undefined),
                        contextInfo: bMsg.contextInfo
                    };
                    message = { interactiveMessage };
                }
                else if (message.templateMessage) {
                    const tmpl = message.templateMessage.hydratedTemplate || message.templateMessage.fourRowTemplate;
                    if (tmpl) {
                        const hydratedButtons = tmpl.hydratedButtons || [];
                        const buttons = hydratedButtons.map(hBtn => {
                            if (hBtn.quickReplyButton) {
                                return {
                                    name: 'quick_reply',
                                    buttonParamsJson: JSON.stringify({
                                        display_text: hBtn.quickReplyButton.displayText || '',
                                        id: hBtn.quickReplyButton.id || hBtn.quickReplyButton.displayText || ''
                                    })
                                };
                            } else if (hBtn.urlButton) {
                                return {
                                    name: 'cta_url',
                                    buttonParamsJson: JSON.stringify({
                                        display_text: hBtn.urlButton.displayText || '',
                                        url: hBtn.urlButton.url || '',
                                        merchant_url: hBtn.urlButton.url || ''
                                    })
                                };
                            } else if (hBtn.callButton) {
                                return {
                                    name: 'cta_call',
                                    buttonParamsJson: JSON.stringify({
                                        display_text: hBtn.callButton.displayText || '',
                                        phone_number: hBtn.callButton.phoneNumber || ''
                                    })
                                };
                            }
                            return null;
                        }).filter(Boolean);
                        const interactiveMessage = {
                            nativeFlowMessage: {
                                buttons,
                                messageParamsJson: '',
                                messageVersion: 1
                            },
                            body: { text: tmpl.hydratedContentText || tmpl.contentText || '' },
                            footer: tmpl.hydratedFooterText ? { text: tmpl.hydratedFooterText } : undefined,
                            header: tmpl.hydratedTitleText
                                ? { title: tmpl.hydratedTitleText, hasMediaAttachment: false, subtitle: '' }
                                : (tmpl.imageMessage || tmpl.videoMessage || tmpl.documentMessage
                                    ? { hasMediaAttachment: true, ...(tmpl.imageMessage ? { imageMessage: tmpl.imageMessage } : {}), ...(tmpl.videoMessage ? { videoMessage: tmpl.videoMessage } : {}) }
                                    : undefined),
                            contextInfo: tmpl.contextInfo
                        };
                        message = { interactiveMessage };
                    }
                }
                const patched = await patchMessageBeforeSending(message);
                if (Array.isArray(patched)) {
                    throw new Boom('Per-jid patching is not supported in groups');
                }
                const bytes = encodeWAMessage(patched);
                reportingMessage = patched;
                const groupAddressingMode = additionalAttributes?.['addressing_mode'] || groupData?.addressingMode || 'lid';
                const groupSenderIdentity = groupAddressingMode === 'lid' && meLid ? meLid : meId;
                const { ciphertext, senderKeyDistributionMessage } = await signalRepository.encryptGroupMessage({
                    group: destinationJid,
                    data: bytes,
                    meId: groupSenderIdentity
                });
                const senderKeyRecipients = [];
                for (const device of devices) {
                    const deviceJid = device.jid;
                    const hasKey = !!senderKeyMap[deviceJid];
                    if ((!hasKey || !!participant) &&
                        !isHostedLidUser(deviceJid) &&
                        !isHostedPnUser(deviceJid) &&
                        device.device !== 99) {
                        senderKeyRecipients.push(deviceJid);
                        senderKeyMap[deviceJid] = true;
                    }
                }
                if (senderKeyRecipients.length) {
                    logger.debug({ senderKeyJids: senderKeyRecipients }, 'sending new sender key');
                    const senderKeyMsg = {
                        senderKeyDistributionMessage: {
                            axolotlSenderKeyDistributionMessage: senderKeyDistributionMessage,
                            groupId: destinationJid
                        }
                    };
                    const senderKeySessionTargets = senderKeyRecipients;
                    await assertSessions(senderKeySessionTargets);
                    const result = await createParticipantNodes(senderKeyRecipients, senderKeyMsg, extraAttrs);
                    shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || result.shouldIncludeDeviceIdentity;
                    participants.push(...result.nodes);
                }
                binaryNodeContent.push({
                    tag: 'enc',
                    attrs: { v: '2', type: 'skmsg', ...extraAttrs },
                    content: ciphertext
                });
                await authState.keys.set({ 'sender-key-memory': { [jid]: senderKeyMap } });
            }
            else {
                let ownId = meId;
                if (isLid && meLid) {
                    ownId = meLid;
                    logger.debug({ to: jid, ownId }, 'Using LID identity for @lid conversation');
                }
                else {
                    logger.debug({ to: jid, ownId }, 'Using PN identity for @s.whatsapp.net conversation');
                }
                const { user: ownUser } = jidDecode(ownId);
                if (!participant) {
                    const patchedForReporting = await patchMessageBeforeSending(message, [jid]);
                    reportingMessage = Array.isArray(patchedForReporting)
                        ? patchedForReporting.find(item => item.recipientJid === jid) || patchedForReporting[0]
                        : patchedForReporting;
                }
                if (!isRetryResend) {
                    const targetUserServer = isLid ? 'lid' : 's.whatsapp.net';
                    devices.push({
                        user,
                        device: 0,
                        jid: jidEncode(user, targetUserServer, 0)
                    });
                    if (user !== ownUser) {
                        const ownUserServer = isLid ? 'lid' : 's.whatsapp.net';
                        const ownUserForAddressing = isLid && meLid ? jidDecode(meLid).user : jidDecode(meId).user;
                        devices.push({
                            user: ownUserForAddressing,
                            device: 0,
                            jid: jidEncode(ownUserForAddressing, ownUserServer, 0)
                        });
                    }
                    if (additionalAttributes?.['category'] !== 'peer') {
                        devices.length = 0;
                        const senderIdentity = isLid && meLid
                            ? jidEncode(jidDecode(meLid)?.user, 'lid', undefined)
                            : jidEncode(jidDecode(meId)?.user, 's.whatsapp.net', undefined);
                        const sessionDevices = await getUSyncDevices([senderIdentity, jid], true, false);
                        devices.push(...sessionDevices);
                        logger.debug({
                            deviceCount: devices.length,
                            devices: devices.map(d => `${d.user}:${d.device}@${jidDecode(d.jid)?.server}`)
                        }, 'Device enumeration complete with unified addressing');
                    }
                }
                const allRecipients = [];
                const meRecipients = [];
                const otherRecipients = [];
                const { user: mePnUser } = jidDecode(meId);
                const { user: meLidUser } = meLid ? jidDecode(meLid) : { user: null };
                for (const { user, jid } of devices) {
                    const isExactSenderDevice = jid === meId || (meLid && jid === meLid);
                    if (isExactSenderDevice) {
                        logger.debug({ jid, meId, meLid }, 'Skipping exact sender device (whatsmeow pattern)');
                        continue;
                    }
                    const isMe = user === mePnUser || user === meLidUser;
                    if (isMe) {
                        meRecipients.push(jid);
                    }
                    else {
                        otherRecipients.push(jid);
                    }
                    allRecipients.push(jid);
                }
                await assertSessions(allRecipients);
                const [{ nodes: meNodes, shouldIncludeDeviceIdentity: s1 }, { nodes: otherNodes, shouldIncludeDeviceIdentity: s2 }] = await Promise.all([
                    createParticipantNodes(meRecipients, meMsg || message, extraAttrs),
                    createParticipantNodes(otherRecipients, message, extraAttrs, meMsg)
                ]);
                participants.push(...meNodes);
                participants.push(...otherNodes);
                if (meRecipients.length > 0 || otherRecipients.length > 0) {
                    extraAttrs['phash'] = generateParticipantHashV2([...meRecipients, ...otherRecipients]);
                }
                shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || s1 || s2;
            }
            if (isRetryResend) {
                const isParticipantLid = isLidUser(participant.jid);
                const isMe = areJidsSameUser(participant.jid, isParticipantLid ? meLid : meId);
                const encodedMessageToSend = isMe
                    ? encodeWAMessage({
                        deviceSentMessage: {
                            destinationJid,
                            message
                        }
                    })
                    : encodeWAMessage(message);
                const { type, ciphertext: encryptedContent } = await signalRepository.encryptMessage({
                    data: encodedMessageToSend,
                    jid: participant.jid
                });
                binaryNodeContent.push({
                    tag: 'enc',
                    attrs: {
                        v: '2',
                        type,
                        count: participant.count.toString()
                    },
                    content: encryptedContent
                });
            }
            if (participants.length) {
                if (additionalAttributes?.['category'] === 'peer') {
                    const peerNode = participants[0]?.content?.[0];
                    if (peerNode) {
                        binaryNodeContent.push(peerNode);
                    }
                }
                else {
                    binaryNodeContent.push({
                        tag: 'participants',
                        attrs: {},
                        content: participants
                    });
                }
            }
            const stanza = {
                tag: 'message',
                attrs: {
                    id: msgId,
                    to: destinationJid,
                    type: getMessageType(message),
                    ...(additionalAttributes || {})
                },
                content: binaryNodeContent
            };
            if (participant) {
                if (isJidGroup(destinationJid)) {
                    stanza.attrs.to = destinationJid;
                    stanza.attrs.participant = participant.jid;
                }
                else if (areJidsSameUser(participant.jid, meId)) {
                    stanza.attrs.to = participant.jid;
                    stanza.attrs.recipient = destinationJid;
                }
                else {
                    stanza.attrs.to = participant.jid;
                }
            }
            else {
                stanza.attrs.to = destinationJid;
            }
            if (shouldIncludeDeviceIdentity) {
                ;
                stanza.content.push({
                    tag: 'device-identity',
                    attrs: {},
                    content: encodeSignedDeviceIdentity(authState.creds.account, true)
                });
                logger.debug({ jid }, 'adding device identity');
            }
            if (!isNewsletter &&
                !isRetryResend &&
                reportingMessage?.messageContextInfo?.messageSecret &&
                shouldIncludeReportingToken(reportingMessage)) {
                try {
                    const encoded = encodeWAMessage(reportingMessage);
                    const reportingKey = {
                        id: msgId,
                        fromMe: true,
                        remoteJid: destinationJid,
                        participant: participant?.jid
                    };
                    const reportingNode = await getMessageReportingToken(encoded, reportingMessage, reportingKey);
                    if (reportingNode) {
                        ;
                        stanza.content.push(reportingNode);
                        logger.trace({ jid }, 'added reporting token to message');
                    }
                }
                catch (error) {
                    logger.warn({ jid, trace: error?.stack }, 'failed to attach reporting token');
                }
            }
            const contactTcTokenData = !isGroup && !isRetryResend && !isStatus ? await authState.keys.get('tctoken', [destinationJid]) : {};
            const tcTokenBuffer = contactTcTokenData[destinationJid]?.token;
            if (tcTokenBuffer) {
                ;
                stanza.content.push({
                    tag: 'tctoken',
                    attrs: {},
                    content: tcTokenBuffer
                });
            }
            if (!AI && isPnUser(destinationJid)) {
                const alreadyHasBizBot =
                    getBinaryFilteredBizBot(additionalNodes || []) ||
                    getBinaryFilteredBizBot(stanza.content);
                if (!alreadyHasBizBot) {
                    stanza.content.push({ tag: 'bot', attrs: { biz_bot: '1' } });
                }
            } else if (AI && !isGroup && !isStatus && !isNewsletter) {
                const existingBizBot = getBinaryFilteredBizBot(additionalNodes || []);
                if (!existingBizBot) {
                    stanza.content.push({ tag: 'bot', attrs: { biz_bot: '1' } });
                }
            }
            if (additionalNodes && additionalNodes.length > 0) {
                stanza.content.push(...additionalNodes);
            }
            logger.debug({ msgId }, `sending message to ${participants.length} devices`);
            await sendNode(stanza);
            if (messageRetryManager && !participant) {
                messageRetryManager.addRecentMessage(destinationJid, msgId, message);
            }
        }, meId);
        return msgId;
    };
    const getMessageType = (message) => {
        if (message?.groupStatusMessageV2 || message?.groupStatusMessage) {
            return 'text';
        }
        const normalizedMessage = normalizeMessageContent(message);
        if (!normalizedMessage)
            return 'text';
        if (normalizedMessage.reactionMessage || normalizedMessage.encReactionMessage) {
            return 'reaction';
        }
        if (normalizedMessage.pollCreationMessage ||
            normalizedMessage.pollCreationMessageV2 ||
            normalizedMessage.pollCreationMessageV3 ||
            normalizedMessage.pollUpdateMessage) {
            return 'poll';
        }
        if (normalizedMessage.eventMessage) {
            return 'event';
        }
        if (normalizedMessage.interactiveMessage) {
            return 'text';
        }
        if (getMediaType(normalizedMessage) !== '') {
            return 'media';
        }
        return 'text';
    };
    const getMediaType = (message) => {
        if (message.imageMessage) {
            return 'image';
        }
        else if (message.videoMessage) {
            return message.videoMessage.gifPlayback ? 'gif' : 'video';
        }
        else if (message.ptvMessage) {
            return 'video';
        }
        else if (message.audioMessage) {
            return message.audioMessage.ptt ? 'ptt' : 'audio';
        }
        else if (message.contactMessage) {
            return 'vcard';
        }
        else if (message.documentMessage) {
            return 'document';
        }
        else if (message.contactsArrayMessage) {
            return 'contact_array';
        }
        else if (message.liveLocationMessage) {
            return 'livelocation';
        }
        else if (message.stickerMessage) {
            return 'sticker';
        }
        else if (message.stickerPackMessage) {
            return 'sticker_pack';
        }
        else if (message.listMessage) {
            return 'list';
        }
        else if (message.listResponseMessage) {
            return 'list_response';
        }
        else if (message.buttonsResponseMessage) {
            return 'buttons_response';
        }
        else if (message.orderMessage) {
            return 'order';
        }
        else if (message.productMessage) {
            return 'product';
        }
        else if (message.interactiveResponseMessage) {
            return 'native_flow_response';
        }
        else if (message.groupInviteMessage) {
            return 'url';
        }
        return '';
    };
    const getPrivacyTokens = async (jids) => {
        const t = unixTimestampSeconds().toString();
        const result = await query({
            tag: 'iq',
            attrs: {
                to: S_WHATSAPP_NET,
                type: 'set',
                xmlns: 'privacy'
            },
            content: [
                {
                    tag: 'tokens',
                    attrs: {},
                    content: jids.map(jid => ({
                        tag: 'token',
                        attrs: {
                            jid: jidNormalizedUser(jid),
                            t,
                            type: 'trusted_contact'
                        }
                    }))
                }
            ]
        });
        return result;
    };
    const waUploadToServer = getWAUploadToServer(config, refreshMediaConn);
    const waitForMsgMediaUpdate = bindWaitForEvent(ev, 'messages.media-update');
    const getButtonType = (message) => {
        if (message.listMessage) return 'list';
        if (message.buttonsMessage) return 'buttons';
        if (message.templateMessage) return 'template';
        if (message.interactiveMessage?.nativeFlowMessage) return 'native_flow';
        if (message.interactiveMessage?.shopStorefrontMessage) return 'shop';
        if (message.interactiveMessage?.collectionMessage) return 'collection';
        if (message.interactiveMessage?.carouselMessage) return 'carousel';
        if (message.interactiveMessage) return 'interactive';
        return null;
    };
    const getButtonArgs = (message) => {
        const nativeFlow = message.interactiveMessage?.nativeFlowMessage;
        const firstButtonName = nativeFlow?.buttons?.[0]?.name;
        const nativeFlowSpecials = [
            'mpm', 'cta_catalog', 'send_location',
            'call_permission_request', 'wa_payment_transaction_details',
            'automated_greeting_message_view_catalog'
        ];
        const ts = unixTimestampSeconds().toString();
        const bizBase = { actual_actors: '2', host_storage: '2', privacy_mode_ts: ts };
        const qualityControl = { tag: 'quality_control', attrs: { source_type: 'third_party' } };
        if (nativeFlow && (firstButtonName === 'review_and_pay' || firstButtonName === 'payment_info')) {
            return {
                tag: 'biz',
                attrs: { native_flow_name: firstButtonName === 'review_and_pay' ? 'order_details' : firstButtonName }
            };
        } else if (nativeFlow && nativeFlowSpecials.includes(firstButtonName)) {
            return {
                tag: 'biz', attrs: bizBase,
                content: [{
                    tag: 'interactive', attrs: { type: 'native_flow', v: '1' },
                    content: [{ tag: 'native_flow', attrs: { v: '2', name: firstButtonName } }]
                }, qualityControl]
            };
        } else if (nativeFlow || message.buttonsMessage || message.templateMessage || message.interactiveMessage) {
            return {
                tag: 'biz', attrs: bizBase,
                content: [{
                    tag: 'interactive', attrs: { type: 'native_flow', v: '1' },
                    content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }]
                }, qualityControl]
            };
        } else if (message.listMessage) {
            return {
                tag: 'biz', attrs: bizBase,
                content: [{ tag: 'list', attrs: { v: '2', type: 'product_list' } }, qualityControl]
            };
        } else {
            return { tag: 'biz', attrs: bizBase };
        }
    };
    return {
        ...sock,
        getPrivacyTokens,
        assertSessions,
        relayMessage,
        sendReceipt,
        sendReceipts,
        readMessages,
        refreshMediaConn,
        waUploadToServer,
        fetchPrivacySettings,
        sendPeerDataOperationMessage,
        createParticipantNodes,
        getUSyncDevices,
        messageRetryManager,
        updateMemberLabel,
        updateMediaMessage: async (message) => {
            const content = assertMediaContent(message.message);
            const mediaKey = content.mediaKey;
            const meId = authState.creds.me.id;
            const node = encryptMediaRetryRequest(message.key, mediaKey, meId);
            let error = undefined;
            await Promise.all([
                sendNode(node),
                waitForMsgMediaUpdate(async (update) => {
                    const result = update.find(c => c.key.id === message.key.id);
                    if (result) {
                        if (result.error) {
                            error = result.error;
                        }
                        else {
                            try {
                                const media = decryptMediaRetryData(result.media, mediaKey, result.key.id);
                                if (media.result !== proto.MediaRetryNotification.ResultType.SUCCESS) {
                                    const resultStr = proto.MediaRetryNotification.ResultType[media.result];
                                    throw new Boom(`Media re-upload failed by device (${resultStr})`, {
                                        data: media,
                                        statusCode: getStatusCodeForMediaRetry(media.result) || 404
                                    });
                                }
                                content.directPath = media.directPath;
                                content.url = getUrlFromDirectPath(content.directPath);
                                logger.debug({ directPath: media.directPath, key: result.key }, 'media update successful');
                            }
                            catch (err) {
                                error = err;
                            }
                        }
                        return true;
                    }
                })
            ]);
            if (error) {
                throw error;
            }
            ev.emit('messages.update', [{ key: message.key, update: { message: message.message } }]);
            return message;
        },
        resize: async (media, width, height) => {
            const { getStream, toBuffer } = await import('../Utils/messages-media.js');
            let sharp;
            try { sharp = (await import('sharp')).default; } catch (_) {}
            if (!sharp) throw new Error('sharp is required for resize');
            const { stream } = await getStream(media);
            const buf = await toBuffer(stream);
            return sharp(buf).resize(width, height, { fit: 'cover' }).toBuffer();
        },
        sendStatusMentions: async (content, jids = []) => {
            const userJid = jidNormalizedUser(authState.creds.me.id);
            let allUsers = new Set();
            allUsers.add(userJid);

            for (const id of jids) {
                const isGroup = isJidGroup(id);
                const isPrivate = isJidUser(id);
                if (isGroup) {
                    try {
                        const metadata = (cachedGroupMetadata ? await cachedGroupMetadata(id) : null) || await groupMetadata(id);
                        const participants = metadata.participants.map(p => jidNormalizedUser(p.id));
                        participants.forEach(j => allUsers.add(j));
                    } catch (error) {
                        logger.error(`Error getting metadata for group ${id}: ${error}`);
                    }
                } else if (isPrivate) {
                    allUsers.add(jidNormalizedUser(id));
                }
            }

            const uniqueUsers = Array.from(allUsers);
            const getRandomHexColor = () => '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');

            const isMedia = content.image || content.video || content.audio;
            const isAudio = !!content.audio;

            const messageContent = { ...content };

            if (isMedia && !isAudio) {
                if (messageContent.text) {
                    messageContent.caption = messageContent.text;
                    delete messageContent.text;
                }
                delete messageContent.ptt;
                delete messageContent.font;
                delete messageContent.backgroundColor;
                delete messageContent.textColor;
            }
            if (isAudio) {
                delete messageContent.text;
                delete messageContent.caption;
                delete messageContent.font;
                delete messageContent.textColor;
            }

            const font = !isMedia ? (content.font ?? Math.floor(Math.random() * 9)) : undefined;
            const textColor = !isMedia ? (content.textColor ?? getRandomHexColor()) : undefined;
            const backgroundColor = (!isMedia || isAudio) ? (content.backgroundColor ?? getRandomHexColor()) : undefined;
            const ptt = isAudio ? (typeof content.ptt === 'boolean' ? content.ptt : true) : undefined;

            let msg;
            let mediaHandle;
            try {
                msg = await generateWAMessage(STORIES_JID, messageContent, {
                    logger,
                    userJid,
                    getUrlInfo: text => getUrlInfo(text, {
                        thumbnailWidth: linkPreviewImageThumbnailWidth,
                        fetchOpts: { timeout: 3000 },
                        logger,
                        uploadImage: generateHighQualityLinkPreview ? waUploadToServer : undefined
                    }),
                    upload: async (encFilePath, opts) => {
                        const up = await waUploadToServer(encFilePath, { ...opts });
                        mediaHandle = up.handle;
                        return up;
                    },
                    mediaCache: config.mediaCache,
                    options: config.options,
                    font,
                    textColor,
                    backgroundColor,
                    ptt
                });
            } catch (error) {
                logger.error(`Error generating status message: ${error}`);
                throw error;
            }

            await relayMessage(STORIES_JID, msg.message, {
                messageId: msg.key.id,
                statusJidList: uniqueUsers,
                additionalNodes: [{
                    tag: 'meta',
                    attrs: {},
                    content: [{
                        tag: 'mentioned_users',
                        attrs: {},
                        content: jids.map(jid => ({
                            tag: 'to',
                            attrs: { jid: jidNormalizedUser(jid) }
                        }))
                    }]
                }]
            });

            for (const id of jids) {
                try {
                    const normalizedId = jidNormalizedUser(id);
                    const isPrivate = isJidUser(normalizedId);
                    const type = isPrivate ? 'statusMentionMessage' : 'groupStatusMentionMessage';
                    const protocolMessage = {
                        [type]: {
                            message: {
                                protocolMessage: {
                                    key: msg.key,
                                    type: 25
                                }
                            }
                        },
                        messageContextInfo: {
                            messageSecret: randomBytes(32)
                        }
                    };
                    const statusMsg = await generateWAMessageFromContent(normalizedId, protocolMessage, {});
                    await relayMessage(normalizedId, statusMsg.message, {
                        additionalNodes: [{
                            tag: 'meta',
                            attrs: isPrivate
                                ? { is_status_mention: 'true' }
                                : { is_group_status_mention: 'true' }
                        }]
                    });
                    await delay(2000);
                } catch (error) {
                    logger.error(`Error sending status mention to ${id}: ${error}`);
                }
            }

            return msg;
        },
        sendMessage: async (jid, content, options = {}) => {
            const userJid = authState.creds.me.id;
            // ── Normalize: buttons[].nativeFlowInfo -> interactiveButtons ──────
            if (
                typeof content === 'object' &&
                Array.isArray(content.buttons) &&
                content.buttons.length > 0 &&
                content.buttons.some(b => b.nativeFlowInfo)
            ) {
                const interactiveButtons = content.buttons.map(b => {
                    if (b.nativeFlowInfo) {
                        return {
                            name: b.nativeFlowInfo.name,
                            buttonParamsJson: b.nativeFlowInfo.paramsJson || '{}'
                        };
                    }
                    return {
                        name: 'quick_reply',
                        buttonParamsJson: JSON.stringify({
                            display_text: b.buttonText?.displayText || b.buttonId || 'Button',
                            id: b.buttonId || b.buttonText?.displayText || 'btn'
                        })
                    };
                });
                const { buttons, headerType, viewOnce, ...rest } = content;
                content = { ...rest, interactiveButtons };
            }
            if (typeof content === 'object' && Array.isArray(content.interactiveButtons) && content.interactiveButtons.length > 0) {
                const {
                    text = '',
                    caption = '',
                    title = '',
                    footer = '',
                    interactiveButtons,
                    hasMediaAttachment = false,
                    image = null,
                    video = null,
                    document = null,
                    mimetype = null,
                    jpegThumbnail = null,
                    location = null,
                    product = null,
                    businessOwnerJid = null,
                    externalAdReply = null,
                } = content;
                // Normalize buttons
                const processedButtons = [];
                for (let i = 0; i < interactiveButtons.length; i++) {
                    const btn = interactiveButtons[i];
                    if (!btn || typeof btn !== 'object') throw new Error(`interactiveButtons[${i}] must be an object`);
                    if (btn.name && btn.buttonParamsJson) { processedButtons.push(btn); continue; }
                    if (btn.id || btn.text || btn.displayText) {
                        processedButtons.push({ name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: btn.text || btn.displayText || `Button ${i + 1}`, id: btn.id || `quick_${i + 1}` }) });
                        continue;
                    }
                    if (btn.buttonId && btn.buttonText?.displayText) {
                        processedButtons.push({ name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: btn.buttonText.displayText, id: btn.buttonId }) });
                        continue;
                    }
                    throw new Error(`interactiveButtons[${i}] has invalid shape`);
                }
                let messageContent = {};
                if (image) {
                    const mi = Buffer.isBuffer(image) ? { image } : { image: { url: typeof image === 'object' ? image.url : image } };
                    const pm = await prepareWAMessageMedia(mi, { upload: waUploadToServer });
                    messageContent.header = { title: title || '', hasMediaAttachment: true, imageMessage: pm.imageMessage };
                } else if (video) {
                    const mi = Buffer.isBuffer(video) ? { video } : { video: { url: typeof video === 'object' ? video.url : video } };
                    const pm = await prepareWAMessageMedia(mi, { upload: waUploadToServer });
                    messageContent.header = { title: title || '', hasMediaAttachment: true, videoMessage: pm.videoMessage };
                } else if (document) {
                    const mi = Buffer.isBuffer(document) ? { document } : { document: { url: typeof document === 'object' ? document.url : document } };
                    if (mimetype && typeof mi.document === 'object') mi.document.mimetype = mimetype;
                    if (jpegThumbnail) {
                        const thumb = Buffer.isBuffer(jpegThumbnail) ? jpegThumbnail : await (async () => { try { const r = await fetch(jpegThumbnail); return Buffer.from(await r.arrayBuffer()); } catch { return undefined; } })();
                        if (thumb) mi.document.jpegThumbnail = thumb;
                    }
                    const pm = await prepareWAMessageMedia(mi, { upload: waUploadToServer });
                    messageContent.header = { title: title || '', hasMediaAttachment: true, documentMessage: pm.documentMessage };
                } else if (location && typeof location === 'object') {
                    messageContent.header = { title: title || location.name || 'Location', hasMediaAttachment: false, locationMessage: { degreesLatitude: location.degreesLatitude || location.degressLatitude || 0, degreesLongitude: location.degreesLongitude || location.degressLongitude || 0, name: location.name || '', address: location.address || '' } };
                } else if (product && typeof product === 'object') {
                    let productImageMessage = null;
                    if (product.productImage) {
                        const mi = Buffer.isBuffer(product.productImage) ? { image: product.productImage } : { image: { url: typeof product.productImage === 'object' ? product.productImage.url : product.productImage } };
                        const pm = await prepareWAMessageMedia(mi, { upload: waUploadToServer });
                        productImageMessage = pm.imageMessage;
                    }
                    messageContent.header = { title: title || product.title || 'Product', hasMediaAttachment: false, productMessage: { product: { productImage: productImageMessage, productId: product.productId || '', title: product.title || '', description: product.description || '', currencyCode: product.currencyCode || 'USD', priceAmount1000: parseInt(product.priceAmount1000) || 0, retailerId: product.retailerId || '', url: product.url || '', productImageCount: product.productImageCount || 1 }, businessOwnerJid: businessOwnerJid || product.businessOwnerJid || userJid } };
                } else if (title) {
                    messageContent.header = { title, hasMediaAttachment: false };
                }
                const hasMedia = !!(image || video || document || location || product);
                const bodyText = hasMedia ? caption : text || caption;
                if (bodyText) messageContent.body = { text: bodyText };
                if (footer) messageContent.footer = { text: footer };
                messageContent.nativeFlowMessage = { buttons: processedButtons };
                if (externalAdReply && typeof externalAdReply === 'object') {
                    messageContent.contextInfo = { externalAdReply: { title: externalAdReply.title || '', body: externalAdReply.body || '', mediaType: externalAdReply.mediaType || 1, sourceUrl: externalAdReply.sourceUrl || externalAdReply.url || '', thumbnailUrl: externalAdReply.thumbnailUrl || externalAdReply.thumbnail || '', renderLargerThumbnail: externalAdReply.renderLargerThumbnail || false, showAdAttribution: externalAdReply.showAdAttribution !== false, containsAutoReply: externalAdReply.containsAutoReply || false, ...(externalAdReply.mediaUrl && { mediaUrl: externalAdReply.mediaUrl }), ...(Buffer.isBuffer(externalAdReply.thumbnail) && { thumbnail: externalAdReply.thumbnail }), ...(externalAdReply.jpegThumbnail && { jpegThumbnail: externalAdReply.jpegThumbnail }) }, ...(options.mentionedJid && { mentionedJid: options.mentionedJid }) };
                } else if (options.mentionedJid) {
                    messageContent.contextInfo = { mentionedJid: options.mentionedJid };
                }
                const payload = proto.Message.InteractiveMessage.create(messageContent);
                const msg = generateWAMessageFromContent(jid, { viewOnceMessage: { message: { interactiveMessage: payload } } }, { userJid, quoted: options?.quoted || null });
                const additionalNodes = [{ tag: 'biz', attrs: {}, content: [{ tag: 'interactive', attrs: { type: 'native_flow', v: '1' }, content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }] }] }];
                await relayMessage(jid, msg.message, { messageId: msg.key.id, additionalNodes });
                return msg;
            }
            if (typeof content === 'object' &&
                'disappearingMessagesInChat' in content &&
                typeof content['disappearingMessagesInChat'] !== 'undefined' &&
                isJidGroup(jid)) {
                const { disappearingMessagesInChat } = content;
                const value = typeof disappearingMessagesInChat === 'boolean'
                    ? disappearingMessagesInChat
                        ? WA_DEFAULT_EPHEMERAL
                        : 0
                    : disappearingMessagesInChat;
                await groupToggleEphemeral(jid, value);
            }
            else {
                let mediaHandle;
                const fullMsg = await generateWAMessage(jid, content, {
                    logger,
                    userJid,
                    getUrlInfo: text => getUrlInfo(text, {
                        thumbnailWidth: linkPreviewImageThumbnailWidth,
                        fetchOpts: {
                            timeout: 3000,
                            ...(httpRequestOptions || {})
                        },
                        logger,
                        uploadImage: generateHighQualityLinkPreview ? waUploadToServer : undefined
                    }),
                    //TODO: CACHE
                    getProfilePicUrl: sock.profilePictureUrl,
                    getCallLink: sock.createCallLink,
                    newsletter: _isNewsletterJid(jid),
                    upload: async (encFilePath, opts) => {
                        const up = await waUploadToServer(encFilePath, { ...opts, newsletter: _isNewsletterJid(jid) });
                        mediaHandle = up.handle;
                        return up;
                    },
                    mediaCache: config.mediaCache,
                    options: config.options,
                    messageId: generateMessageIDV2(sock.user?.id),
                    ...options
                });
                if (!mediaHandle) {
                    const msgContent = fullMsg.message;
                    const msgTypes = ['audioMessage','imageMessage','videoMessage','documentMessage','stickerMessage'];
                    for (const t of msgTypes) {
                        if (msgContent?.[t]?._uploadHandle) {
                            mediaHandle = msgContent[t]._uploadHandle;

                            delete msgContent[t]._uploadHandle;
                            break;
                        }
                    }
                }
                const isEventMsg = 'event' in content && !!content.event;
                const isDeleteMsg = 'delete' in content && !!content.delete;
                const isEditMsg = 'edit' in content && !!content.edit;
                const isPinMsg = 'pin' in content && !!content.pin;
                const isPollMessage = 'poll' in content && !!content.poll;
                const additionalAttributes = {};
                const additionalNodes = [];
                if (isDeleteMsg) {
                    if (isJidGroup(content.delete?.remoteJid) && !content.delete?.fromMe) {
                        additionalAttributes.edit = '8';
                    }
                    else {
                        additionalAttributes.edit = '7';
                    }
                }
                else if (isEditMsg) {
                    additionalAttributes.edit = '1';
                }
                else if (isPinMsg) {
                    additionalAttributes.edit = '2';
                }
                else if (isPollMessage) {
                    additionalNodes.push({
                        tag: 'meta',
                        attrs: {
                            polltype: 'creation'
                        }
                    });
                }
                else if (isEventMsg) {
                    additionalNodes.push({
                        tag: 'meta',
                        attrs: {
                            event_type: 'creation'
                        }
                    });
                }
                const buttonType = getButtonType(fullMsg.message);
                if (content?.audio && options?.contextInfo) {
                    const msgContent = fullMsg.message;
                    if (msgContent?.audioMessage) {
                        msgContent.audioMessage.contextInfo = options.contextInfo;
                    }
                }
                if (buttonType) {
                    const btnNode = getButtonArgs(fullMsg.message);
                    if (btnNode) additionalNodes.push(btnNode);
                }
                if (mediaHandle) {
                    additionalAttributes['media_id'] = mediaHandle;
                }
                await relayMessage(jid, fullMsg.message, {
                    messageId: fullMsg.key.id,
                    useCachedGroupMetadata: options.useCachedGroupMetadata,
                    additionalAttributes,
                    statusJidList: options.statusJidList,
                    additionalNodes,
                    AI: options.ai || false
                });
                if (config.emitOwnEvents) {
                    process.nextTick(async () => {
                        await messageMutex.mutex(() => upsertMessage(fullMsg, 'append'));
                    });
                }
                return fullMsg;
            }
        }
    };
};