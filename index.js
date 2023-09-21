const express = require( 'express' );
const app = express();
const http = require( 'http' );
const https = require( 'https' );
const axios = require( 'axios' );
const server = http.createServer( app );
const io = require( 'socket.io' )( server );
const fs = require( 'fs' );
const nodemailer = require( 'nodemailer' );
var imaps = require( 'imap-simple' );
const _ = require( 'lodash' );

let email = null;
let token = null;
let name = null;
let display_name = null;
let avatar = null;
let b64Token = null;

app.use( '/ckeditor', express.static( 'ckeditor' ) );

app.get( '/', function ( req, res ) {
	res.writeHead( 200, { 'Content-Type': 'text/html; charset=utf8' } );
	if ( email != null && token != null ){
		fs.createReadStream( './index.html', 'utf8' ).pipe( res );
	}
	else {
		fs.createReadStream( './login.html', 'utf8' ).pipe( res );
	}
});
app.get( '/inbox', function ( req, res ) {
	res.writeHead( 200, { 'Content-Type': 'text/html; charset=utf8' } );
	if ( email != null && token != null ){
		fs.createReadStream( './index.html', 'utf8' ).pipe( res );
	}
	else {
		res.redirect( '/' );
	}
});
app.get( '/new', function ( req, res ) {		
	if ( email != null && token != null ){
		res.writeHead( 200, { 'Content-Type': 'text/html; charset=utf8' } );
		fs.createReadStream( './new.html', 'utf8' ).pipe( res );
	}
	else {
		res.redirect( '/' );
	}
});
app.get( '/message/:id', function ( req, res ) {		
	if ( email != null && token != null ){
		res.writeHead( 200, { 'Content-Type': 'text/html; charset=utf8' } );
		fs.createReadStream( './message.html', 'utf8' ).pipe( res );
	}
	else {
		res.redirect( '/' );
	}
});

io.on( 'connection', ( socket ) => {
	socket.on( 'login', function( data ) {
		token = data.token;
		axios.get( `https://login.yandex.ru/info?format=json&oauth_token=${token}` )
		.then( function( response ) {
			name = response.data.real_name;
			email = response.data.default_email;
			display_name = response.data.display_name;
			avatar = response.data.default_avatar_id;
			b64Token = Buffer.from( "user=" + email + "\001auth=Bearer " + token + "\001\001" ).toString( 'base64' );
			socket.emit( 'login' );
		  })
		  .catch( function( error ) {
			console.log( error );
		  });
	});	
	socket.on( 'userInfo', function() {
		socket.emit( 'userInfo', { display_name: display_name, avatar: avatar } );
	});
	socket.on( 'messageList', function( data ) {
		messageList( data );
	});
	function messageList( data ) {				
		var config = {
			imap: {
				xoauth2: b64Token,
				host: 'imap.yandex.ru',
				port: 993,
				tls: true,
				authTimeout: 3000
			}
		};
	
		imaps.connect( config ).then(function ( connection ) {			
			return connection.openBox( 'INBOX' ).then(function ( inbox ) {				
				var searchCriteria = [`${inbox.messages.total - 29 * data.page}:${inbox.messages.total}`];
	
				var fetchOptions = {
					bodies: [ 'HEADER', 'TEXT' ],
					markSeen: false, 
					struct: true
				};
	
				var uid = [];
				var date = [];
				var from = [];
				var text = [];
				var seen = [];
	
				return connection.search( searchCriteria, fetchOptions ).then(function ( results ) {
					var subjects = results.map(function ( res ) {
						uid.push( res.attributes.uid );
						date.push( res.attributes.date );
						from.push( res.parts.filter( function ( part ) { return part.which === 'HEADER'; } )[0].body.from );
						text.push( res.parts.filter( function ( part ) { return part.which === 'TEXT'; } )[0].body);
						seen.push( res.attributes.flags.indexOf( '\\Seen' ) != -1 );
						if ( res.parts.filter( function ( part ) { return part.which === 'HEADER'; })[0].body.subject == undefined ) {
							return "(Без темы)";
						}
						else {
							return res.parts.filter( function ( part ) { return part.which === 'HEADER'; })[0].body.subject[0];
						}
	
					});
					socket.emit( 'messageList', { subjects: subjects, uid: uid, date: date, from: from, text: text, seen: seen } );
				});
			});
		}).catch( err => {
			if ( err.toString().indexOf( 'Error: AUTHENTICATE invalid credentials or IMAP is disabled' ) != -1 ) {
				socket.emit( 'IMAPdisabled' );
			}
		});	
	};

	socket.on( 'open', function( data ) {
		var config = {
			imap: {
				xoauth2: b64Token,
				host: 'imap.yandex.ru',
				port: 993,
				tls: true,
				authTimeout: 3000
			}
		};

		imaps.connect( config ).then(function ( connection ) {
			connection.openBox( 'INBOX' ).then( function () {
		
				var searchCriteria = [ [ "UID", data.uid ] ];
				var fetchOptions = { bodies: [ 'HEADER', 'TEXT' ], struct: true, markSeen: true };
				return connection.search(searchCriteria, fetchOptions);

			}).then( function ( messages ) {
				messages.map(function ( message ) {					
					return new Promise( ( res, rej ) => {
						var subtype = [];
						var from = [];
						var subject = [];
						var parts = imaps.getParts( message.attributes.struct );
						
						parts.map( function ( part ) {
							if( part.encoding == "7bit" ) { part.encoding = "8bit" };
							
							from.push( message.parts.filter( function ( part ) { return part.which === 'HEADER'; } )[0].body.from );
							subject.push( message.parts.filter( function ( part ) { return part.which === 'HEADER'; } )[0].body.subject );
							return connection.getPartData( message, part )
							.then(function ( partData ) {								
								subtype.push( part.subtype );
								if ( part.encoding != "base64" ) {
									socket.emit( "open", { "mail": partData, subtype: subtype, from: from, subject: subject } );
								}
								else {
									socket.emit( "open", { "mail": Buffer.from ( partData, "base64" ).toString( 'utf-8' ), subtype: subtype, from: from, subject: subject } );
								};
							});
						});
					});
				});
			});
		});
	});
	
	socket.on( 'send', function( data ) {
		async function main() {
		  let transporter = nodemailer.createTransport( {
			host: "smtp.yandex.ru",
			port: 465,
			secure: true,
			auth: {
				type: 'OAuth2',
				user: email,
				accessToken: token
			},
		  });

		  let info = await transporter.sendMail({
			from: `${name} <${email}>`,
			to: data.to,
			subject: data.subject,
			text: data.text,
			html: data.html,
		  });

		  socket.emit( 'sendSuccess' );
		};
		
		main().catch( console.error );
	});
	socket.on( 'delete', function( data ) {
		var config = {
			imap: {
				xoauth2: b64Token,
				host: 'imap.yandex.ru',
				port: 993,
				tls: true,
				authTimeout: 3000
			}
		};
		imaps.connect( config ).then( function ( connection ) {
			connection.openBox( 'INBOX' ).then( function () {
		
				var searchCriteria = [ [ "UID", data.uids ] ];
				var fetchOptions = { bodies: [ 'TEXT' ], struct: true };
				return connection.search( searchCriteria, fetchOptions );

			}).then( function ( messages ) {
				let taskList = messages.map( function ( message ) {
					return new Promise( ( res, rej ) => {
						var parts = imaps.getParts( message.attributes.struct );
						parts.map( function ( part ) {
							return connection.getPartData( message, part )
							.then(function () {
								data.uids.forEach( uid => {
									connection.addFlags(uid, "\Deleted", ( err ) => {
										if ( err ){
											rej( err );
										}
										res();
									})
								});
							});
						});
					});
				});
		
				return Promise.all( taskList ).then( () => {
					connection.imap.closeBox( true, ( err ) => {
						if ( err ){
							console.log( err );
						}
						messageList( data );
					});
					connection.end();
				});
			});
		});
	});

	socket.on( 'seen', function( data ) {
		var config = {
			imap: {
				xoauth2: b64Token,
				host: 'imap.yandex.ru',
				port: 993,
				tls: true,
				authTimeout: 3000
			}
		};
		imaps.connect( config ).then( function ( connection ) {
			connection.openBox( 'INBOX' ).then( function () {
		
				var searchCriteria = [ [ "UID", data.uids ] ];
				var fetchOptions = { bodies: [ 'TEXT' ], struct: true, markSeen: true };
				return connection.search(searchCriteria, fetchOptions);
		
			}).then( function ( messages ) {
				let taskList = messages.map(function ( message ) {
					return new Promise( ( res, rej ) => {
						var parts = imaps.getParts( message.attributes.struct );
						parts.map( function ( part ) {
							return connection.getPartData( message, part )
							.then(function () {
								data.uids.forEach( uid => {
									connection.addFlags( uid, "\Seen", ( err ) => {
										if ( err ) {
											rej( err );
										}
										res();
									});
								});
							});
						});
					});
				});
		
				return Promise.all( taskList ).then( () => {
					connection.imap.closeBox( true, ( err ) => {
						if ( err ){
							console.log( err );
						};
						messageList( data );
					});
					connection.end();
				});
			});
		});
	});
	
	socket.on( 'logout', function() {
		email = null;
		token = null;
		name = null;
		base64 = null;
	});
});


server.listen( process.env.PORT, function () {
	console.log( 'Express server listening on port ' + process.env.PORT );
});