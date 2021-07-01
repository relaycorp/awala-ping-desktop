<img src="./ping-logo.png" align="right"/>

# Awala Ping for Desktop

The Awala Ping for Desktop is CLI implementation of the [Awala Ping Service](https://specs.awala.network/RS-014), which is meant to help test Awala itself.

This document is aimed at advanced users and (prospective) contributors. We aim to make the app as simple and intuitive as possible, and we're therefore not planning on publishing end-user documentation at this point. To learn more about _using_ Awala, visit [awala.network/users](https://awala.network/users).

## Install

This tool is available as [the NPM package `@relaycorp/awala-ping`](https://www.npmjs.com/package/@relaycorp/awala-ping). To install it globally, run:

```shell
npm install -g @relaycorp/awala-ping
```

## Use

### Sending pings

To send a ping, run:

```
awala-ping ping
```

The command above will wait until the pong message is received.

### Registering with the private gateway

By default, the `ping` subcommand will register with the [Awala Gateway for Desktop](https://github.com/relaycorp/awala-gateway-desktop) if the app hasn't been registered yet. To register explicitly, run:

```
awala-ping register
```

Each registration will create an Awala endpoint internally. The latest endpoint to be created will become the default one.

## Security and privacy considerations

The items below summarize the security and privacy considerations specific to this app. For a more general overview of the security considerations in Awala, please refer to [RS-019](https://specs.awala.network/RS-019).

### No personally-identifiable information is stored

This app only stores cryptographically-generated data whose inputs are not derived in any way from personally-identifiable information.

### External communication

This app only communicates with the following:

- The [private gateway](https://github.com/relaycorp/awala-gateway-desktop).
- Any public endpoint that the user sends pings to. By default, the Relaycorp-operated public endpoint at `ping.awala.services` is used.

This app doesn't track usage (for example, using Google Analytics), nor does it use ads.

## Development

To install this app in development, simply run `npm install` from the root of the repository.

To run a subcommand in the CLI, pass the subcommand name to the command `npm run run --`. For example, to send a ping, run:

```shell
npm run run -- ping
```

## Contributing

We love contributions! If you haven't contributed to a Relaycorp project before, please take a minute to [read our guidelines](https://github.com/relaycorp/.github/blob/master/CONTRIBUTING.md) first.
