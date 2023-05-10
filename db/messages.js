const Joi = require('joi');
const db = require('./connection');

const schema = Joi.object().keys({
    role: Joi.string().required(),
    content: Joi.string().required(),
    name: Joi.string().required()
})

const messages = db.get('messages')

async function getMessages() {

}