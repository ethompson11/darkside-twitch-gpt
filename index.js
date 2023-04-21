const express = require('express')
const request = require('request')
const app = express()
const fs = require('fs');
const { promisify } = require('util')
const tmi = require('tmi.js')
let tmiOAuth = {};
async function getOauth() {
  console.debug('OAuth Asked for')

  await request.post('https://id.twitch.tv/oauth2/token', { form: {
    client_id: process.env.TMI_ID,
    client_secret: process.env.TMI_SECRET,
    code: process.env.TMI_CODE,
    grant_type: 'authorization_code',
    redirect_url: 'https://darkside-chatgpt-bot.cyclic.app/'
  }}, function(err, response, body) {
    if(err) {
      return console.log("Error getting oAuth", err);
    }

    try {
      const responseBody = JSON.parse(body)
      tmiOAuth = {
        oauth: responseBody.access_token,
        refresh: responseBody.refresh_token,
        expires: responseBody.expires_in
      }
      console.log("OAuth retrieved")
    } catch(exception) {
      return console.log("Error reading body", body);
    }
  })
}

const readFile = promisify(fs.readFile)
const GPT_MODE = process.env.GPT_MODE || "CHAT"

let file_context = "You are a helpful Twitch Chatbot."

const messages = [
  {role: "system", content: "You are a helpful Twitch Chatbot."}
];

console.log("GPT_MODE is " + GPT_MODE)
console.log("History length is " + process.env.HISTORY_LENGTH)
console.log("OpenAI API Key:" + process.env.OPENAI_API_KEY)

app.use(express.json({extended: true, limit: '1mb'}))

app.all('/', (req, res) => {
    console.log("Just got a request!")
    res.send('Yo!')
})

let tmiClient = undefined;

if (process.env.GPT_MODE === "CHAT"){

  fs.readFile("./file_context.txt", 'utf8', async function(err, data) {
    if (err) throw err;
    console.log("Reading context file and adding it as system level message for the agent.")
    messages[0].content = data;
  });

} else {

  fs.readFile("./file_context.txt", 'utf8', function(err, data) {
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

    if(text == "Deploy Bot" && user == "EdForLife"){
      await getOauth();
      if(tmiOAuth !== {}) {
        tmiClient = new tmi.Client({
          options: {debug: true},
          identity: {
            username: 'SirLurksABot',
            password: tmiOAuth.oauth
          },
          channels: [ 'venalis' ]
        });

        if(tmiClient !== undefined){
          tmiClient.connect();
          tmiClient.say('venalis', 'SirLurksABot has arrived.');
        }
      }

      res.send("SirLurksABot is deploying")
    }
    
    if (GPT_MODE === "CHAT"){
      //CHAT MODE EXECUTION

      //Add user message to  messages
      messages.push({role: "user", content: text, name: user})
      //Check if message history is exceeded
      console.log("Conversations in History: " + ((messages.length / 2) -1) + "/" + process.env.HISTORY_LENGTH)
      if(messages.length > ((process.env.HISTORY_LENGTH * 2) + 1)) {
          console.log('Message amount in history exceeded. Removing oldest user and agent messages.')
          messages.splice(1,2)
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

        console.log ("Agent answer: " + agent_response)
        messages.push({role: "assistant", content: agent_response})

        //Check for Twitch max. chat message length limit and slice if needed
        if(agent_response.length > 399){
          console.log("Agent answer exceeds twitch chat limit. Slicing to first 399 characters.")
          agent_response = agent_response.substring(0, 399)
          console.log ("Sliced agent answer: " + agent_response)
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
          console.log ("Agent answer: " + agent_response)
          //Check for Twitch max. chat message length limit and slice if needed
          if(agent_response.length > 399){
            console.log("Agent answer exceeds twitch chat limit. Slicing to first 399 characters.")
            agent_response = agent_response.substring(0, 399)
            console.log ("Sliced Agent answer: " + agent_response)
          }

          res.send(agent_response)
      } else {
          res.send("Something went wrong. Try again later!")
      }
    }
    
})
app.listen(process.env.PORT || 3000)
