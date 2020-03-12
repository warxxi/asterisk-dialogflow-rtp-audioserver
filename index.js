const RtpServer = require('./lib/RTPServer');
const config = require('config');
const mqtt = require('async-mqtt');
const Pino = require('pino');
const DialogFlowConnector = require('./lib/DialogFlowConnector');
const log = new Pino({
    name: 'Dialogflow-AudioServer',
});

let rtpServer = new RtpServer(config.get('rtpServer'), log);
const mqttTopicPrefix = config.get('mqtt.prefix');

let connectorsMap = new Map();
let mqttClient;

async function createNewGoogleStream(payload) {

    log.info({ payload }, 'New Stream of audio from Asterisk to send to Dialogflow');

    const audioConfig = {
        audioEncoding: 'AUDIO_ENCODING_LINEAR_16',
        sampleRateHertz: 16000,
        languageCode: 'en-US'
    };

    const dialogFlowConfig = {
        projectId: config.get('dialogflow.project'),
        sessionId: payload.channelId,
        initialEventName: config.get('dialogflow.initialEventName')
    }

    let dialogflowConnector = new DialogFlowConnector(audioConfig, dialogFlowConfig, payload.channelId, log);

    let audioDataStream = rtpServer.createStream(payload.port);

    dialogflowConnector.start(audioDataStream);

    connectorsMap.set(payload.channelId, dialogflowConnector);

    dialogflowConnector.on('message', async (data) => {
        log.info(`Got a message sending to ${mqttTopicPrefix}/events`);
        await mqttClient.publish(`${mqttTopicPrefix}/events`, JSON.stringify(data));
    });
}

function stopDialogflowStream(payload) {
    log.info({ payload }, 'Ending stream of audio from Asterisk to send to Dialogflow');

    let connector = connectorsMap.get(payload.channelId);

    if (connector) {
        connector.close();
        connectorsMap.delete(payload.channelId);
    }

    rtpServer.endStream(payload.port);
}

async function run() {

    mqttClient = await mqtt.connectAsync(config.get('mqtt.url'));
    log.info('Connected to MQTT');

    await mqttClient.subscribe(`${mqttTopicPrefix}/newStream`);
    await mqttClient.subscribe(`${mqttTopicPrefix}/streamEnded`);
    log.info('Subscribed to both newStream & streamEnded topic');

    mqttClient.on('message', (topic, message) => {
        let payload = JSON.parse(message.toString());

        switch(topic) {
            case `${mqttTopicPrefix}/newStream`:
                createNewGoogleStream(payload);
                break;
            case `${mqttTopicPrefix}/streamEnded`:
                stopDialogflowStream(payload);
                break;
            default:
                break;
        }
    });

    rtpServer.on('err', (err) => {

        streamsMap.forEach((stream, key) => {
            stream.end();
            streamsMap.delete(key);
        });

        throw err;
    });

    rtpServer.bind();
    log.info('AudioServer listening on UDP port');
}

run();
