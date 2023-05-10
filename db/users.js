const Joi = require('joi');
const db = require('./connection');

const schema = Joi.object().keys({
    auth_code: Joi.string().required(),
    auth_granted: Joi.date().required(),
    current_tokens: Joi.object().keys({
        access: Joi.string().required(),
        refresh: Joi.string().required(),
        expiration: Joi.date().required()
    }).required(),
    service: Joi.string().required(),
    user_id: Joi.number().integer().required(),
    username: Joi.string().required()
});

const users = db.get('users');

function getUser(service, username) {
    console.debug(`Looking up user ${username} for service ${service}`);
    return users.findOne({service: service, username: username});
}

function addUser(user){
    const result = schema.validate(user);

    if(result.error == null) {
        return users.insert(user);
    } else {
        return Promise.reject(result.error);
    }
}

function updateUser(service, username, newUser){
    const result = schema.validate(newUser.$set);

    if(result.error == null) {
        return users.findOneAndUpdate({service: service, username: username}, newUser);
    } else {
        return Promise.reject(result.error);
    }
}

module.exports = {
    getUser,
    addUser,
    updateUser
}