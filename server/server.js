import 'process';
import fs from 'fs';
import Neode from 'neode';

import Models from './models/index.js';
import LobbyManager from './lobby-manager.js';
import GameManager from './game-manager.js';
import Game from './game/game.js';
import PaperScissorsRock from './game/psr.js';
import TokenGenerator from './token-generator.js';
import 'process';

export default class Server {
    /** @type {Server} */
    static instance;

    /** @type {LobbyManager} */
    lobbyManager = new LobbyManager();
    /** @type {GameManager} */
    gameManager = new GameManager();

    /** @type {[String]} */
    static defaultAgentToken = '00000000';


    //TODO? How will this work. Config file?
    /** @type {[String]} */
    games;

    /** @type {typeof Game}} */
    Game = PaperScissorsRock;

    constructor() {
        if (Server.instance) {
            return Server.instance;
        }

        /** @type {Neode} */
        this.dbInstance = Neode.fromEnv().with(Models);

        Server.instance = this;
    }

    async loadTestData() {
        const numAgents = 20;
        const numGames = 10;

        console.log('Cleaning Database...');
        await this.deleteAll();

        console.log('Initializing default agent...');
        await this.getDefaultAgent();

        console.log('Generating User Data...');
        const studentNumbers = [...new Array(numAgents)].map((_, i) => String(10000 * i + 20000000));

        const tokengen = new TokenGenerator();
        const userData = tokengen.computeStudentTokens(studentNumbers);

        console.log('Creating Users and Agents...');
        const agents = [];
        for (let { studentNumber, authToken } of userData) {
            const user = await this.createUser(studentNumber, authToken);
            const agent = await this.createAgent(user, '/code');

            agents.push(agent);
        }

        console.log('Creating Games');
        for (let i = 0; i < numGames; i++) {
            // pick 5 without replacement
            const usersInGame =  [...studentNumbers]
                .sort(() => 0.5 - Math.random())  // shuffle
                .slice(0, 5);

            await this.recordGame(usersInGame);
        }

        console.log('Finished');
        return;
    }

    /**
     * Drops every instance of every label from the db
     */
    async deleteAll() {
        await Promise.all(Object.keys(Models).map((label) => this.dbInstance.deleteAll(label)));
    }

    /**
     * @returns {Neode.Node<Models.User>}
     */
    async getDefaultUser() {
        const defaultAgent = await this.dbInstance.find('User', Server.defaultAgentToken);
        if (defaultAgent) {
            return defaultAgent;
        }

        const user = await this.createUser(Server.defaultAgentToken, '000000');
        const agent = await this.dbInstance.create('Agent', {
            srcPath: '???',
        });

        await Promise.all([
            user.relateTo(agent, 'controls'),
            agent.relateTo(user, 'controls'),
        ]);

        return await this.dbInstance.find('User', Server.defaultAgentToken);
    }

    /**
     * Creates the default user if they do not exist
     * @returns {Neode.Node<Models.Agent>}
     */
    async getDefaultAgent() {
        const user = await this.getDefaultUser();
        const agent = user.get('controls').endNode();
        return agent;
    }

    /**
     * @returns {Neode.Node<Models.Game>}
     */
    async createGameNode() {
        return await this.dbInstance.create('Game', {});
    }

    /**
     * @TODO Test
     * @param {String} userToken
     * @param {String | Number} studentNumber
     * @returns {Neode.Node<Models.User>}
     */
    async createUser(userToken, studentNumber) {
        return await this.dbInstance.create('User', {
                studentNumberString: String(studentNumber),
                authenticationTokenString: userToken,
        });
    }

    /**
     * @param {Neode.Node<Models.User>} user
     * @param {String} srcPath
     * @returns {Neode.Node<Models.Agent>}
     */
    async createAgent(user, srcPath) {
        let agent = await this.dbInstance.create('Agent', {
            srcPath: srcPath,
        });

        await Promise.all([
            user.relateTo(agent, 'controls'),
            agent.relateTo(user, 'controls'),
        ]);

        return await this.dbInstance.find('Agent', agent.id());
    }

    /**
     * @TODO Test
     * @param {String} userToken
     * @return {Neode.Node<Models.Agent> | null} Agent model
     */
    async getUserAgent(userToken) {
        const user = await this.dbInstance.find(
            'User', userToken
        );

        const edge = user.get('controls');
        if (!edge) {
            return null;
        }

        const agent = edge.endNode();
        return agent;
    }

    /**
     * @TODO Test
     * @param {String} userToken
     * @return {Neode.Node<Models.Game>[]}
     */
    async getUserGames(userToken) {
        const agent = await this.getUserAgent(userToken);
        const games = agent.get('playedIn').endNode();

        return games;
    }

    /**
     * Only a user with a valid agent can play
     * Returns whether they have a valid agent
     * @param {String} userToken
     * @return {Boolean}
     */
    async isUserEligibleToPlay(userToken) {
        return !!await this.getUserAgent(userToken);
    }

    /**
     * Creates agent <-> game edges in the db
     * @param {String[]} userTokens
     */
    async recordGame(userTokens) {
        const game = await this.createGameNode();

        for (let userToken of userTokens) {
            // Might need score to be set
            const agent = await this.getUserAgent(userToken);
            await Promise.all([
                agent.relateTo(game, 'playedIn'),
                game.relateTo(agent, 'playedIn'),
            ]);
        }
    }

    /**
     * Generates and assigns a token for each student number in the file
     * One student number should be present on each line
     * @param {String} studentNumbersFilePath string containing the file path of the student numbers file
     * @returns {{studentNumber: String, authToken: String}[]} an array of objects with the last token generated at the last index
     */
    generateUserTokens(studentNumbersFilePath) {
        let studentNumbersFileContent;
        try {
            studentNumbersFileContent = fs.readFileSync(studentNumbersFilePath)
                .toString();
        } catch (exception) {
            console.error(`Cannot read specified file, please check permission and location\n${exception}`);
            return [];
        }

        const studentNumbers = studentNumbersFileContent
            .trim()
            .split('\n');

        const tokengen = new TokenGenerator();
        return tokengen.computeStudentTokens(studentNumbers);
    }

    /**
     * @TODO Nathan will overwrite this ig
     */
    async assignPlayerToLobby(userToken, numPlayers) {
        const lobbyManager = this.lobbyManagers[numPlayers]; // Check numPlayers exists in obj;
        lobbyManager.addPlayed(userToken);
    }

    async close() {
        this.dbInstance.close();
    }
}
