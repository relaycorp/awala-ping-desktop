<img src="./ping-logo.png" style="float: right" alt="Awala Ping logo"/>

# Awala Ping for Desktop

The Awala Ping for Desktop is CLI implementation of the [Awala Ping Service](https://specs.awala.network/RS-014), which is meant to help test Awala itself.

This document is aimed at advanced users and (prospective) contributors. To learn more about using Awala in general, visit [awala.network/users](https://awala.network/users).

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

### Sending pings to custom endpoints

By default, the `ping` subcommand will communicate with the public endpoint at `ping.awala.services`. If you wish to use a different endpoint, you need to:

1. Download the identity certificate for the public endpoint with which you want to communicate.
1. Import the endpoint first with the `third-party-endpoints import-public` subcommand. For example:
   ```shell
   awala-ping third-party-endpoints import-public your-endpoint.com < /path/to/id-cert.der
   ```
1. Specify the public address of your custom endpoint when you send pings. For example:
   ```shell
   awala-ping ping your-endpoint.com
   ```

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
