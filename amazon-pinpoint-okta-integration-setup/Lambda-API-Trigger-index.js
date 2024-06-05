const AWS = require('aws-sdk');

var aws_region = "us-east-1";

var originationNumber = process.env.FROM_PHONE_NUMBER;

var destinationNumber = "";

var userLanguage = "en-US"; //setting default

var applicationId = process.env.PINPOINT_APP_ID;

var messageType = "TRANSACTIONAL";

var senderId = process.env.SENDER_ID;

var callerId = process.env.CALLER_ID;


AWS.config.update({ region: aws_region });

exports.handler = async (event) => {
  console.log(event.body);
  const data = (JSON.parse(event.body)).data;

  destinationNumber = data.messageProfile["phoneNumber"];
  if (data.messageProfile["locale"])
    userLanguage = data.messageProfile["locale"];

  var userOtpCode = data.messageProfile["otpCode"];

  var deliveryChannel = data.messageProfile["deliveryChannel"].toLowerCase();

  var messageObj = await getMessageFromDynamo(userLanguage, deliveryChannel);
  if (!messageObj) {
    return getErrorResponse(deliveryChannel, {message: "Message not found for language: " + userLanguage});
  }

  /*
    ** sample voice message (@otp will be replaced with the actual otp coming in request)
    `<speak>Your One-Time Passcode from the AWS Pinpoint project is <emphasis> @otp </emphasis>
    <amazon:effect phonation='soft'>Thank you for listening.</amazon:effect></speak>`

    ** sample sms message
    Your One-Time Passcode from the AWS Pinpoint project is @otp.
  */
 
    function formatOtp(otpCode, deliveryChannel) {
      if (deliveryChannel === 'voice') {
        return otpCode.split('').join(', ');
      } else {
        return otpCode;
      }
    }
    
    messageObj['message'] = messageObj['message'].replace('@otp', formatOtp(userOtpCode, deliveryChannel));
  
  if (deliveryChannel === "sms") {
    return await sendSms(messageObj['message'])
      .then(data => {
        console.log(
          "Message sent! " +
          data["MessageResponse"]["Result"][destinationNumber]["StatusMessage"]
        );
        return getSuccessResponse('sms', data["MessageResponse"]["Result"][destinationNumber]["StatusMessage"]);
      })
      .catch(err => {
        console.error(err);
        return getErrorResponse('sms', err);
      });
  } else {
    return await makeCall(messageObj)
      .then(data => {
        return getSuccessResponse('voice', data["MessageId"]);
      })
      .catch(err => {
        console.error(err);
        return getErrorResponse('voice', err);
      });
  }
};



async function sendSms(message) {

  var pinpoint = new AWS.Pinpoint();

  var params = {
    ApplicationId: applicationId,
    MessageRequest: {
      Addresses: {
        [destinationNumber]: {
          ChannelType: "SMS",
        },
      },
      MessageConfiguration: {
        SMSMessage: {
          Body: message,
          MessageType: messageType,
          OriginationNumber: originationNumber,
          SenderId: senderId,
        },
      },
    },
  };

  return new Promise((resolve, reject) => {
    pinpoint.sendMessages(params, function (err, data) {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}


async function makeCall(messageObj) {
  
  var pinpointsmsvoice = new AWS.PinpointSMSVoice();

  var params = {
    CallerId: callerId,
    Content: {
      SSMLMessage: {
        LanguageCode: messageObj['pinpointlanguage'],
        Text: messageObj['message'],
        VoiceId: messageObj['voiceid'],
      },
    },
    DestinationPhoneNumber: destinationNumber,
    OriginationPhoneNumber: originationNumber,
  };

  return new Promise((resolve, reject) => {
    pinpointsmsvoice.sendVoiceMessage(params, function (err, data) {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });

}

// Returns the success response in telephony hook's expected API contract
function getSuccessResponse(method, sid) {
  console.log("Successfully sent " + method + " : " + sid);
  const actionKey = "com.okta.telephony.action";
  const actionVal = "SUCCESSFUL";
  const providerName = "AWSPinpoint";
  const resp = {
    commands: [
      {
        type: actionKey,
        value: [
          {
            status: actionVal,
            provider: providerName,
            transactionId: sid,
          },
        ],
      },
    ],
  };
  return {
    "statusCode": 200,
    "body": JSON.stringify(resp),
  }
}

// Returns the error response in telephony hook's expected API contract
function getErrorResponse(method, error) {
  console.log("Error in " + method + " : " + error);
  const errorResp = {
    error: {
      errorSummary: error.message,
      // errorCauses: [
      //   {
      //     errorSummary: error.status,
      //     reason: error.moreInfo,
      //     location: error.detail,
      //   },
      // ],
    },
  };
  return {
    "statusCode": 400,
    "body": JSON.stringify(errorResp),
  }
}


async function getMessageFromDynamo(language, deliveryChannel) {
  const docClient = new AWS.DynamoDB.DocumentClient();

  const params = {
    TableName: process.env.DYNAMODB_TABLE_NAME,
    FilterExpression: "#language = :language AND #messagetype = :messagetype",
    ExpressionAttributeNames: {
      "#language": "language",
      "#messagetype": "messagetype",
    },
    ExpressionAttributeValues: {
      ":language": language,
      ":messagetype": deliveryChannel,
    },
  };

  try {
    const response = await docClient.scan(params).promise();
    return response.Items[0];
  } catch (error) {
    console.error(error);
    return null;
  }
}
