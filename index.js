const express = require('express')
const request = require('request')
const axios = require('axios')
const app = express()
const qs = require('qs')
const fs = require('fs');
const { promisify } = require('util')
const tmi = require('tmi.js')
const users = require('./db/users');
const { exit } = require('process')
let currentUser = undefined;

require('dotenv').config()
let tmiOAuth = undefined;
let tmiClient = undefined;
let oauthForm = {
  client_id: process.env.TMI_ID,
  client_secret: process.env.TMI_SECRET,
  code: process.env.TMI_CODE,
  grant_type: 'authorization_code',
  redirect_uri: 'https://darkside-chatgpt-bot.cyclic.app/'
};

async function getOauth(username) {
  console.debug('OAuth Asked for')

  const user = await users.getUser('twitch', username.toLowerCase())
    .then(function (result) {
      console.debug('User Found');
      return result;
    }).catch(function (error) {
      console.debug(`Error finding user: ${error}`);
      return undefined;
    });

  if (user) {
    delete user['_id'];
    console.debug(user);
    if (user.current_tokens.access == '') {
      oauthForm.code = user.auth_code;
      await axios.post('https://id.twitch.tv/oauth2/token', qs.stringify(oauthForm))
        .then(function (response) {
          try {
            const responseBody = response.data
            const newExpiration = new Date();
            newExpiration.setSeconds(newExpiration.getSeconds() + responseBody.expires_in)

            user.current_tokens = {
              access: responseBody.access_token,
              refresh: responseBody.refresh_token,
              expiration: newExpiration
            }

            const updatedUser = {
              $set: user
            }

            users.updateUser('twitch', user.username, updatedUser)
              .then(function (response) {
                console.log("User Updated")
              }).catch(function (error) {
                console.debug(`User Update Failed: ${error}`)
              })
          } catch (exception) {
            console.error("Error reading body", response.data);
          }
        }).catch(function (error) {
          console.error("Error with request", error)
        }).finally(function () {
          console.log("Request Processing Finished")
        });
    } else if (new Date(user.current_tokens.expiration) < new Date()) {
      console.debug('OAuth Expired');
      oauthForm = {
        client_id: process.env.TMI_ID,
        client_secret: process.env.TMI_SECRET,
        refresh_token: user.current_tokens.refresh,
        grant_type: 'refresh_token'
      }

      await axios.post('https://id.twitch.tv/oauth2/token', qs.stringify(oauthForm))
        .then(function (response) {
          try {
            console.log("OAuth retrieved")
            const responseBody = response.data
            const newExpiration = new Date(user.current_tokens.expiration)
            newExpiration.setSeconds(newExpiration.getSeconds() + 14400)

            user.current_tokens = {
              access: responseBody.access_token,
              refresh: responseBody.refresh_token,
              expiration: newExpiration
            }

            const updatedUser = {
              $set: user
            }

            users.updateUser('twitch', user.username, updatedUser)
              .then(function (response) {
                console.log("User Updated")
              }).catch(function (error) {
                console.debug(`User Update Failed: ${error}`)
              })
          } catch (exception) {
            console.error("Error reading body", response.data);
          }
        })
    } else {
      console.debug('OAuth Valid');
    }
  }

  currentUser = user;
}

const readFile = promisify(fs.readFile)
const GPT_MODE = process.env.GPT_MODE || "CHAT"

let file_context = "You are a helpful Twitch Chatbot."

const messages = [
  { role: "system", content: "You are a helpful Twitch Chatbot." }
];
let chatMessages = [];

console.log("GPT_MODE is " + GPT_MODE)
console.log("History length is " + process.env.HISTORY_LENGTH)
console.log("OpenAI API Key:" + process.env.OPENAI_API_KEY)

app.use(express.json({ extended: true, limit: '1mb' }))

app.all('/', (req, res) => {
  console.log("Just got a request!")
  res.send('Yo!')
})

if (process.env.GPT_MODE === "CHAT") {

  fs.readFile("./bot_context.txt", 'utf8', async function (err, data) {
    if (err) throw err;
    console.log("Reading context file and adding it as system level message for the agent.")
    messages[0].content = data;
  });

} else {

  fs.readFile("./file_context.txt", 'utf8', function (err, data) {
    if (err) throw err;
    console.log("Reading context file and adding it in front of user prompts:")
    file_context = data;
    console.log(file_context);
  });

}

app.get('/gpt/:user/:text', async (req, res) => {

  //The agent should recieve Username:Message in the text to identify conversations with different users in his history. 

  const text = req.params.text
  const user = req.params.user
  const { Configuration, OpenAIApi } = require("openai");

  const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const openai = new OpenAIApi(configuration);

  if (text == "Deploy Bot") {
    try {
      await getOauth(user);
      if (currentUser != undefined) {
        console.debug(`token: ${currentUser.current_tokens.access}`);

        tmiClient = new tmi.Client({
          options: { debug: true },
          identity: {
            username: currentUser.username,
            password: `oauth:${currentUser.current_tokens.access}`
          },
          channels: ['venalis']
        });



        if (tmiClient !== undefined) {
          tmiClient.connect();
          tmiClient.on('join', (channel, tags, message, self) => {
            if (tags == currentUser.username && message) {
              messages.push({
                role: 'user',
                content: 'introduce yourself to chat',
                name: 'system'
              })
            }
          })

          let replying = false;
          let seeingDouble = false;
          let napping = false;
          let isGiveaway = false;
          const mods = ['athenahaa', 'aurablaze91', 'aurora_bot', 'azhrein', 'cableslave', 'classypax', 'crream', 'derrickster', 'domina_bot', 'draconicleaftalarus', 'echoics', 'edforlife', 'fabulouscuddle', 'faricai', 'ferret_bot', 'fistofthewalrus', 'gassymexican', 'intheend99lp', 'jo777_xd', 'karter_bot', 'khymiras', 'librizzi', 'lowco', 'mactheer159', 'marley_bot', 'miss_flynn', 'nightbot', 'orangelabrador', 'ponypunch', 'pulseeffects', 'restreambot', 'streamelements', 'tehg00se', 'thats_jarman', 'timthetatman', 'wonder_boy_', 'zelda_ish'];
          const ignoreList = ['venaGPT', 'streamelements'];
          const emotes = ['venaTrigger', 'venaShark', 'venaCop', 'venaSweat', 'venaNuggies'];
          let triggerEmote = "";
          let participants = [];
          let lastWinner = "";

            tmiClient.on('message', async (channel, tags, message, self) => {
              if (self || ignoreList.some((ignore) => tags['display-name'].toLowerCase() == ignore)) return;
              if (mods === []) mods = await tmiClient.mods(channel).catch((error) => { return; });
              if (!self && tags['display-name'] === 'SirLurksABot' && !seeingDouble){
                replying = true;
                seeingDouble = true;
                setTimeout(() => {
                  tmiClient.raw(":edforlife!edforlife@edforlife.tmi.twitch.tv WHISPER SirLurksABot :Oh, ummm ... someone spiked my punch cause I'm seeing double. I'm out!");
                  tmiClient.part(channel).catch((error) => { return; });
                  replying = false;
                  seeingDouble = false;
                }, 5000);
                return;
              }

              if (messages.length > process.env.HISTORY_LENGTH) {
                messages.splice(1, messages.length - process.env.HISTORY_LENGTH);
              }

              if (tags['display-name'] == 'EdForLife' || tags['display-name'] == 'Venalis') {
                switch (true) {
                  case message == 'Lurks, take a nap':
                    napping = true;
                    tmiClient.say(channel, "Ok chat, I'm gonna go take a nap now. Be back later! venaComfy");
                    setTimeout(function () { napping = false; }, 1200000);
                    return;
                  case message.includes('Lurks, update your prompt with ') === true:
                    messages[0].content += '\n' + message.split(' with ')[1]
                    tmiClient.say(channel, "Ok, I've updated my prompts. venaNote");
                    return;
                  case message == 'Lurks, time to go':
                    tmiClient.say(channel, "Aight chat, I'm heading out. Hope you enjoyed my time here! venaWave");
                    napping = true;
                    return;
                  case message == 'Lurks, time to wake up':
                    tmiClient.say(channel, "venaYawn Ok, let's get the day going! venaWave");
                    napping = false;
                    return;
                  default:
                    break;
                }
              }

              if (mods.some(v => tags['username'] == v)) {
                switch (true) {
                  case message.includes('Lurks, ignore messages from ') === true:
                    let who = message.split(' from ')[1];
                    ignoreList.push(who);
                    messages[0].content += '\n' + `Ignore messages from or mentioning ${who}`;
                    tmiClient.say(channel, `If that's what they want, I will ignore ${who} and messages mentioning them. Hope we can still be friends tho, ${who}. venaTug `);
                    return;
                  case message == 'Lurks, it is time for a giveaway':
                    isGiveaway = true;
                    participants = [];
                    triggerEmote = emotes[Math.floor(Math.random() * emotes.length)];
                    tmiClient.say(channel, `Sweet! It is time for another giveaway. The trigger emote will be ... ${triggerEmote} . Say ${triggerEmote} in chat to enter! Good Luck!`);
                    return;
                  case message == 'Lurks, stop the giveaway' && isGiveaway:
                    isGiveaway = false;
                    tmiClient.say(channel, `Ok! The giveaway has been stopped. Let me know when to pick a winner, ${tags['display-name']} ! venaChamp `);
                    return;
                  case message == 'Lurks, pick a winner' && !isGiveaway:
                    if(participants.includes(lastWinner)){
                      participants.splice(participants.indexOf(lastWinner));
                    }
                    lastWinner = participants[Math.floor(Math.random() * participants.length)];
                    tmiClient.say(channel, `Sweet! @${tags['display-name']} The winner of this giveaway is: @${lastWinner} CONGRATS!`);
                    return;
                  default:
                    break;
                }
              }

              if(isGiveaway && message.includes(triggerEmote)){
                if(!participants.includes(tags['display-name'])) {
                  participants.push(tags['display-name']);
                }
                return;
              }

              if (!napping) {
                chatMessages.push(`@${tags['display-name']} ${message}`);
                if (chatMessages.length == 20) {
                  console.log("Conversations in History: " + ((messages.length / 2) - 1) + "/" + process.env.HISTORY_LENGTH)
                  if (messages.length > ((process.env.HISTORY_LENGTH * 2) + 1)) {
                    console.log('Message amount in history exceeded. Removing oldest user and agent messages.')
                    messages.splice(1, 2)
                  }
                  messages.push({
                    role: "system",
                    content: `Last 20 chat messages: ${chatMessages.splice(0, 20).join('\n')}`,
                    name: "system"
                  },
                    {
                      role: 'user',
                      content: 'reply to a random message',
                      name: 'system'
                    })
                }

                if (message.toLowerCase().indexOf('lurktalk') >= 0
                  || message.toLowerCase().indexOf('sirlurksabot') >= 0
                  || message.toLowerCase().indexOf('sirlurks') >= 0
                  || message.toLowerCase().indexOf('lurks') >= 0
                  || message.toLowerCase().indexOf('lurksalot') >= 0
                  || message.toLowerCase().indexOf('sirlurksalot') >= 0) {
                  //Check if message history is exceeded
                  console.log("Conversations in History: " + ((messages.length / 2) - 1) + "/" + process.env.HISTORY_LENGTH)
                  if (messages.length > ((process.env.HISTORY_LENGTH * 2) + 1)) {
                    console.log('Message amount in history exceeded. Removing oldest user and agent messages.')
                    messages.splice(1, 2)
                  }
                  // Manipulate message for shorter messages
                  message = `${tags['display-name']} ${message}`
                  //Add user message to  messages
                  messages.push({ role: "system", content: message, name: tags['display-name'] })

                  messages.push({
                    role: 'user',
                    content: `write a reply to @${tags['display-name']}'s latest message`,
                    name: 'system'
                  });
                }

                if (messages[messages.length - 1].role == 'user' && !replying) {
                  try {
                    replying = true;
                    console.log("Messages: ")
                    console.dir(messages)
                    console.log("User Input: " + messages[messages.length - 1].content)

                    const response = await openai.createChatCompletion({
                      model: "gpt-3.5-turbo",
                      messages: messages,
                      temperature: 0.8
                    });

                    if (response.data.choices) {
                      let agent_response = response.data.choices[0].message.content

                      if (agent_response.length >= 300) {
                        console.debug(`Agent answer too long: ${agent_response}`);
                        agent_response = "Sorry, I was about to be wordy and have been 'corrected'. venaCry ";
                      }

                      console.log("Agent answer: " + agent_response)
                      messages.push({ role: "assistant", content: agent_response })

                      tmiClient.say(channel, agent_response)
                    } else {
                      tmiClient.say(channel, "Something went wrong. Try again later!")
                    }
                    replying = false;
                  } catch (userError) {
                    console.error(`Error while responding: ${userError}`);
                    messages.splice(messages.length - 2, 2);
                    replying = false;
                  }
                }
              }
            })
        }
      }
    } catch (err) {
      console.error("Issue deploying", err);
    }

    res.send("SirLurksABot is deploying")

  } else if (GPT_MODE === "CHAT") {
    //CHAT MODE EXECUTION

    //Add user message to  messages
    messages.push({ role: "user", content: text, name: user })
    //Check if message history is exceeded
    console.log("Conversations in History: " + ((messages.length / 2) - 1) + "/" + process.env.HISTORY_LENGTH)
    if (messages.length > ((process.env.HISTORY_LENGTH * 2) + 1)) {
      console.log('Message amount in history exceeded. Removing oldest user and agent messages.')
      messages.splice(1, 2)
    }

    console.log("Messages: ")
    console.dir(messages)
    console.log("User Input: " + text)

    const response = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: messages
    });

    if (response.data.choices) {
      let agent_response = response.data.choices[0].message.content

      console.log("Agent answer: " + agent_response)
      messages.push({ role: "assistant", content: agent_response })

      //Check for Twitch max. chat message length limit and slice if needed
      if (agent_response.length > 399) {
        console.log("Agent answer exceeds twitch chat limit. Slicing to first 399 characters.")
        agent_response = agent_response.substring(0, 399)
        console.log("Sliced agent answer: " + agent_response)
      }

      res.send(agent_response)
    } else {
      res.send("Something went wrong. Try again later!")
    }

  } else {
    //PROMPT MODE EXECUTION
    const prompt = file_context + "\n\nQ:" + text + "\nA:";
    console.log("User Input: " + text)

    const response = await openai.createCompletion({
      model: "text-davinci-003",
      prompt: prompt,
      temperature: 0.5,
      max_tokens: 128,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    });
    if (response.data.choices) {
      let agent_response = response.data.choices[0].text
      console.log("Agent answer: " + agent_response)
      //Check for Twitch max. chat message length limit and slice if needed
      if (agent_response.length > 399) {
        console.log("Agent answer exceeds twitch chat limit. Slicing to first 399 characters.")
        agent_response = agent_response.substring(0, 399)
        console.log("Sliced Agent answer: " + agent_response)
      }

      res.send(agent_response)
    } else {
      res.send("Something went wrong. Try again later!")
    }
  }

})
app.listen(process.env.PORT || 3000)
