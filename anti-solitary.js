registerPlugin({
	name: 'Anti-Solitary-Clients',
	version: '1.2.3',
	engine: '>= 1.0.0',
	description: 'Move or punish solitary clients ( being alone in a channel ) after a specific time.',
	author: 'TwentyFour',
	vars: [{
		name: 'dev_debug',
		title: 'Enable debug log',
		type: 'checkbox'
	},{
		name: 'soliTime',
		title: 'Duration of max. allowed solitary time: [ in min // lower limit = 1 min]',
		type: 'number',
		placeholder: 10,
		default: 10
	}, {
		name: 'checkTime',
		title: 'Interval of performing actions: [ in s // lower limit = 5s ]',
		type: 'number',
		placeholder: 30,
		default: 30
	}, {
		name: 'kickChan',
		title: 'Upgrade move to a kick from channel',
		type: 'checkbox'
	}, {
		name: 'moveToChan',
		title: 'Channel to move to: ( >> automatically safe then )',
		type: 'channel',
		conditions: [
			{ field: 'kickChan', value: false }
		]
	}, {
		name: 'kickMsg',
		title: 'Enter the kick message:',
		type: 'string',
		indent: 1,
		placeholder: 'Don\'t idle solo!',
		default: 'Don\'t idle solo!',
		conditions: [
			{ field: 'kickChan', value: true }
		]
	}, {
		name: 'kickServ',
		title: 'Increase to a kick from server!',
		type: 'checkbox',
		indent: 1,
		conditions: [
			{ field: 'kickChan', value: true }
		]
	}, {
		name: 'ignoreGroups',
		title: 'Enter whitelisted server groups: ( >> leave empty for none )',
		type: 'strings'
	}, {
		name: 'mercyMode',
		title: 'Different treatment regarding audio status:',
		type: 'select',
		default: "0",
		options: [
			'Normal-Mode >> ALL - treated equally despite audio status',
			'Exception-Mode >> ALL - except the following audio status',
			'Reserve-Mode >> NONE - only the following audio status'
		]
	}, {
		name: 'mercyMute',
		title: 'Consider [MUTE] ?',
		type: 'checkbox',
		indent: 1
	}, {
		name: 'mercyDeaf',
		title: 'Consider [DEAF] ?',
		type: 'checkbox',
		indent: 1
	}, {
		name: 'mercyAway',
		title: 'Consider [AWAY] ?',
		type: 'checkbox',
		indent: 1
	}, {
		name: 'checkChannelHow',
		title: 'Choose mode to check which channel:',
		type: 'select',
		default: "0",
		options: [
			'Normal-Mode >> Check ALL channel',
			'Whitelist-Mode >> ALL - but the selected',
			'Blacklist-Mode >> NONE - besides the selected'
		]
	}, {
		name: 'checkChannelList',
		title: 'SELECT here: ( Lobby is always safe, when channel kick is enabled! )',
		type: 'array',
		indent: 1,
		vars: [{
			name: 'chan',
			title: 'Channel: ',
			type: 'channel'
		}, {
			name: 'inclSubChannel',
			title: 'Include all sub-channel ( just one level deeper >> NO "sub-sub"-channel! )',
			type: 'checkbox'
		}, {
			name: 'inclSubSubChannel',
			title: '+ one more level ( "sub-sub"-channel )',
			type: 'checkbox',
			indent: 1,
			conditions: [
				{ field: 'inclSubChannel', value: true }
			]
		}]
	}, {
		name: 'punishWithGroup',
		title: 'Additonally assign a "punish"-servergroup?',
		type: 'checkbox'
	}, {
		name: 'punishNrIncidents',
		title: 'Amount of allowed incidents: [ 0 = on the first delict ]',
		type: 'number',
		placeholder: 0,
		default: 0,
		indent: 1,
		conditions: [
			{ field: 'punishWithGroup', value: true }
		]
	}, {
		name: 'punishTimeIncidents',
		title: 'Interval duration of these amount: [ in min // -1 until relog ]',
		type: 'number',
		placeholder: -1,
		default: -1,
		indent: 1,
		conditions: [
			{ field: 'punishWithGroup', value: true }
		]
	}, {
		name: 'punishGroup',
		title: 'Server group ID:',
		type: 'number',
		indent: 1,
		conditions: [
			{ field: 'punishWithGroup', value: true }
		]
	}]
}, (_, config, meta) => {
	const backend = require('backend')
	const engine = require('engine')
	const event = require('event')

	// Check if values are set properly
	if (config.soliTime < 1) config.soliTime = 1;
	if (config.checkTime < 5) config.checkTime = 5;
	if (config.punishTimeIncidents < -1) config.punishTimeIncidents = -1;
	if (config.punishNrIncidents < 0) config.punishNrIncidents = 0;
	const checkMUTE = (typeof config.mercyMute == 'undefined') ? false : config.mercyMute;
	const checkDEAF = (typeof config.mercyDeaf == 'undefined') ? false : config.mercyDeaf;
	const checkAWAY = (typeof config.mercyAway == 'undefined') ? false : config.mercyAway;
	const DEBUG = config.dev_debug;
	const SOLITIME = config.soliTime;
	const INTERVAL = config.checkTime;
	const MOVETO = config.moveToChan;
	const IGNORE_MODE = parseInt(config.checkChannelHow);
	const AUDIO_MODE = parseInt(config.mercyMode);
	var ready = false;
	var iso = [];
	var incidents = [];
	var ignoreGroups = config.ignoreGroups;
	var ignoreChannel = [];
	var checkChannel = [];

/** ############################################################################################
 * 											EVENTS
 * ########################################################################################## */
/**
 * Delay start-up to prevent backend not ready
 */
	event.on('load', (_) => {
		engine.log(`Started ${meta.name} (${meta.version}) by >> @${meta.author} <<`);
		setTimeout(Init, 5000);
	})
/**
 * Get new data after connection loss
 */
	event.on('connect', (_) => {
		iso = [];
		Init();
		engine.log(`${meta.name} >> (Re-)Connected to server ... getting new data!`);
	})
/**
 * Pause while dc'ed
 */
	event.on('disconnect', (_) => {
		ready = false;
		engine.log(`${meta.name} >> Disconnected from server ... pausing until reconnect!`);
	})
/**
 * Check channel composition on every move event
 */
	event.on('clientMove', moveInfo => {
		if (ready) {
			var EVfromChannel = null;
			var EVtoChannel = null;
			var DBfromMatch = null;
			var fromID = null;
			var DBtoMatch = null;
			var toID = null;

			// Check and prepare
			if (moveInfo.fromChannel !== undefined) {
				EVfromChannel = moveInfo.fromChannel;
			}
			if (moveInfo.toChannel !== undefined) {
				EVtoChannel = moveInfo.toChannel;
			}
			if (EVfromChannel) {
				fromID = EVfromChannel.id();
				if (iso[EVfromChannel.id()] !== undefined) {
					DBfromMatch = iso[fromID];
				}
			}
			if (EVtoChannel) {
				toID = EVtoChannel.id();
				if (iso[EVtoChannel.id()] !== undefined) {
					DBtoMatch = iso[toID];
				}
			}
			var fromChannel = backend.getChannelByID(fromID);
			// If move came from isolated channel >> REMOVE
			if (DBfromMatch) {
				if (fromChannel) {
					if (fromChannel.getClientCount() !== 1) iso[fromID] = null;
				}
			}
			// Is fromChannel now an isolated channel? >> ADD
			else {
				if (fromID) {
					if (fromChannel) {
						if (fromChannel.getClientCount() == 1) {
							iso[fromID] = {
								user: EVfromChannel.getClients()[0].id(),
								since: Date.now()
							}
						}
					}
				}
			}
			var toChannel = backend.getChannelByID(toID);
			// If move made channel non-isolated >> REMOVE
			if (DBtoMatch) {
				if (toChannel) {
					if (toChannel.getClientCount() !== 1) iso[toID] = null;			
				}
			}
			// Is toChannel now an isolated channel? >> ADD
			else {
				if (toID) {
					if (toChannel) {
						if (toChannel.getClientCount() == 1) {
							iso[toID] = {
								user: EVtoChannel.getClients()[0].id(),
								since: Date.now()
							}
						}
					}
				}
			}
		}
	})
/** ############################################################################################
 * 										FUNCTION DECLARATIONS
 * ########################################################################################## */
/**
 * Start-up routine: Check all existing channels
 */
	function Init() {
		if (!backend.isConnected()) {
			engine.log(`${meta.name} >> ERROR: Bot was not online! Please reload, after making sure it is connected to a server!`);
			return;
		}
		InitLists();
		let AllChannel = backend.getChannels();
		AllChannel.forEach((channel) => {
			if (channel.isDefault()) ignoreChannel.push(channel.id());
			// Check if isolation channel
			if (channel.getClientCount() == 1) {
				if (!iso[channel.id()]) {
					iso[channel.id()] = {}
				}
				// Create entry
				iso[channel.id()] = {
					user: channel.getClients()[0].id(),
					since: Date.now()
				}
			}
		})
		ready = true;
		setInterval(CheckTime, INTERVAL * 1000);
		setInterval(InitLists, SOLITIME * 30000);		// Re-fetching the channel structure twice per solitary time interval
	}
/**
 * Get Channel White-/Blacklist
 */
	function InitLists() {
		if (!backend.isConnected()) {
			engine.log(`${meta.name} >> ERROR: Bot was not online! Please reload, after making sure it is connected to a server!`);
			return;
		}
		let igCh = [];
		let chCh = [];
		let AllChannel = backend.getChannels();

		// Create to channel arrays to filter with
		if (config.kickChan && !config.kickServ) {
			AllChannel.forEach((channel) => {
				if (channel.isDefault()) igCh.push(channel.id());
			})
		}
		else if (!config.kickServ) {
			igCh.push(MOVETO);
		}
		switch (IGNORE_MODE) {
			case 0:
				break;
			case 1:
				for (var i = 0; i < config.checkChannelList.length; i++) {
					igCh.push(config.checkChannelList[i].chan);
					if (config.checkChannelList[i].inclSubChannel) {
						// sub channel
						let array = getSubchannels(config.checkChannelList[i].chan);
						array.forEach((channel) => {
							// sub sub channel
							if (config.checkChannelList[i].inclSubSubChannel) {
								let subarray = getSubchannels(channel.id());
								subarray.forEach((subchannel) => {
									igCh.push(subchannel.id());
								})
							}
							igCh.push(channel.id());
						})
					}
				}
				break;
			case 2:
				for (var i = 0; i < config.checkChannelList.length; i++) {
					chCh.push(config.checkChannelList[i].chan);
					if (config.checkChannelList[i].inclSubChannel) {
						// sub channel
						let array = getSubchannels(config.checkChannelList[i].chan);
						array.forEach((channel) => {
							// sub sub channel
							if (config.checkChannelList[i].inclSubSubChannel) {
								let subarray = getSubchannels(channel.id());
								subarray.forEach((subchannel) => {
									chCh.push(subchannel.id());
								})
							}
							chCh.push(channel.id());
						})
					}
				}
				break;
		}
		ignoreChannel = igCh;
		checkChannel = chCh;
	}
/**
 * Periodically check the isolation times
 */
	function CheckTime() {
		if (!backend.isConnected() || !ready) return;
		let AllChannel = backend.getChannels();
		for (var i = 0; i < AllChannel.length; i++) {
			// Check if entry present
			let id = AllChannel[i].id();
			if (iso[id] !== null && iso[id] !== undefined) {
				// Process channel depending on setting
				if (IGNORE_MODE == 0 && ignoreChannel.includes(id))  continue;
				if (IGNORE_MODE == 1 && ignoreChannel.includes(id))  continue;
				if (IGNORE_MODE == 2 && !checkChannel.includes(id))  continue;

				// Calculate the isolation time
				let since = iso[id].since;
				let diff = Date.now() - since;
				if (diff > (SOLITIME * 60000)) {
					// if surpassed >> execute punishment
					TakeAction(iso[id].user);
				}			
			}
		}
	}
/**
 * If isolated client found >> execute punishment
 * @param {string} clientID		the temporary TS-ID
 */
	function TakeAction(clientID) {
		if (!backend.isConnected()) return;
		let user = backend.getClientByID(clientID);
		// Exclude whitelisted server groups
		let ignore = false;
		ignoreGroups.forEach((group) => {
			if (!ignore) ignore = hasServerGroupWithId(user, group);
		})
		if (ignore) {
			if (DEBUG) engine.log(`${meta.name} >> Ignored ${user.name()} due to whitelisted group.`);
			return;
		}
		// Exclude by audio status
		let skip = false;
		switch (AUDIO_MODE) {
			case 0:
				break;
			case 1:
				if (checkMUTE && user.isMuted()) skip = true;
				else if (checkDEAF && user.isDeaf()) skip = true;
				else if (checkAWAY && user.isAway()) skip = true;
				break;
			case 2:
				skip = true;
				if (checkMUTE && user.isMuted()) skip = false;
				else if (checkDEAF && user.isDeaf()) skip = false;
				else if (checkAWAY && user.isAway()) skip = false;
				break;
		}
		if (skip) {
			if (DEBUG) engine.log(`${meta.name} >> Ignored ${user.name()} due to configured audio status.`);
			return;
		}

		// Store the incidence
		if (config.punishWithGroup) {
			let inc = incidents[clientID];
			let count = 0;
			if (inc !== null && inc !== undefined) count = inc.length;
			if (config.punishNrIncidents < count+1) {
				if (config.punishTimeIncidents == -1) addServerGroup(user, config.punishGroup);
				else {
					incidents[clientID] = inc.filter(date => { 
						if ( (Date.now() - date) <= (config.punishTimeIncidents * 60000) ) return true;
						else return false;
					});
					if (incidents[clientID].length >= config.punishNrIncidents) addServerGroup(user, config.punishGroup);
				}
			}
			if (inc == null && inc == undefined) incidents[clientID] = [Date.now()];
			else incidents[clientID].push(Date.now());
		}		

		// Execute 
		if (config.kickServ) {
			user.kickFromServer(config.kickMsg);
			if (DEBUG) engine.log(`${meta.name} >> Server-Kick issued to: ${user.name()}`);
			return;
		}
		if (config.kickChan) {
			user.kickFromChannel(config.kickMsg);
			if (DEBUG) engine.log(`${meta.name} >> Channel-Kick issued to: ${user.name()}`);
			return;
		}
		user.moveTo(MOVETO);
		if (DEBUG) engine.log(`${meta.name} >> Move issued to: ${user.name()}`);
		return;
	}
/**
 * Auxiliary function to check for a servergroup
 * @param {Client} client to be checked
 * @param {string} groupId to check for
 * @return {boolean}
 */
	function hasServerGroupWithId(client, groupId) {
		let clientsGroups = [];
		client.getServerGroups().forEach(
			function (group) {
				clientsGroups.push(group.id());
			})
		if(clientsGroups.indexOf(groupId) > -1) return true;
		return false;
	}
/**
 * Adds a server group if not already present
 * @param {Client} client 	to add the group
 * @param {number} groupId 	server group ID as number
 */
	function addServerGroup(client, groupId) {
		if (client != undefined) {
			if (!hasServerGroupWithId(client, groupId.toString())) {
				client.addToServerGroup(groupId);
				if (DEBUG) engine.log(`${meta.name} >> Added pushish group to ${client.name()}.`);
			}
		}
	}
/**
 * Returns an array with all sub-channel objects
 * @param {string} ChannelID 
 * @return {Channel[]} sub channel array
 */
	function getSubchannels(ChannelID) {
		let AllChannel = backend.getChannels();
		let result = [];
		for (var i = 0; i < AllChannel.length; i++) {
			let currentParChannel = AllChannel[i].parent();
			if (currentParChannel && (currentParChannel.id() == ChannelID)) {
				result.push(AllChannel[i]);
			}
		}
		return result;
	}
});