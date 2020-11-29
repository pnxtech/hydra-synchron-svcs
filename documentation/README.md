# Documentation
#### Main: [⇧](../README.md)
---

## How it works:

The Hydra-synchron-svcs implements these features:

* Tasks are registered with the Synchron service.
* Tasks can be registered by a sending service for itself or another service.
* A task is a [UMF message](https://github.com/pnxtech/umf/blob/master/umf.md) with an embedded UMF sub-message.
* Tasks have an execution rule which defines when and how messages are sent to a service.
* All tasks are stored in a Mongo database allowing for the synchron service to be restarted.
* When a task is ready for execution, Synchron can either use a `hydra.sendMessage` or `hydra.queueMessage` to notify the intended recipient service.  The notification is essentially just the registered sub-message.
* Tasks can be registered (created), deregistered (deleted), suspended, resumed, and their status can be queried.  However, tasks are immutable. If you need to update a task you should deregister it and then register a new one.

Here's an example of a registration message:

```javascript
{
  "to": "hydra-synchron-svcs:/",
  "frm": "some-other-svcs:/",
  "mid": "f6d23d41-9698-47c8-b859-68240bead9d1",
  "typ": "synchron.register",
  "bdy": {
    "rule": {
      "frequency": "every 15 hours",
      "sendType": "queue",
      "broadcast": false,
      "updateMid": true,
      "updateFrm": true
    },
    "message": {
      "to": "some-other-svcs:/",
      "frm": "some-other-svcs:/",
      "mid": "4a2c6968-90d7-4ede-b2d4-9c768ce46d49",
      "typ": "perform.sweep",
      "bdy": {
        "actions": {}
      }
    }
  }
}
```

Here's an example of the message that would be queued for the `some-other-svcs` microservice, every 15 hours.


```javascript
{
  "to": "some-other-svcs:/",
  "frm": "hydra-synchron-svcs:/",
  "mid": "148068c4-af4a-4fa3-afcc-e18c8b742801",
  "typ": "perform.sweep",
  "bdy": {
    "actions": {}
  }
}
```

## Task Types

Synchron can be sent one of the following types of messages.

| Message Type | Usage |
|------|-------|
| synchron.register | First time registration of a task |
| synchron.deregister | Remove a registered task |
| synchron.suspend | Suspect a registered task |
| synchron.resume | Resume a registered task |
| synchron.status | Get the status of a registered task |

> Important: synchron tasks are immutable. If you find that need to update an existing registered task you should deregister the task and register a new one.

#### synchron.register

The registration process consists of queuing a message for the `hydra-sychron-svcs:/` as we've seen earlier.

```javascript
{
  "to": "hydra-synchron-svcs:/",
  "frm": "some-other-svcs:/",
  "mid": "f6d23d41-9698-47c8-b859-68240bead9d1",
  "typ": "synchron.register",
  "bdy": {
    "rule": {
      "frequency": "every 15 hours",
      "sendType": "queue",
      "broadcast": false,
      "updateMid": true,
      "updateFrm": true
    },
    "message": {
      "to": "some-other-svcs:/",
      "frm": "some-other-svcs:/",
      "mid": "4a2c6968-90d7-4ede-b2d4-9c768ce46d49",
      "typ": "perform.sweep",
      "bdy": {
        "actions": {}
      }
    }
  }
}
```

The register task will create a new task entry (with a task ID) and store it in a Mongo database for safe keeping. Then a message will be queued back to the sending service with the following creation receipt:

```javascript
{
  "to": "some-other-svcs:/",
  "frm": "hydra-synchron-svcs:/",
  "mid": "f6d23d41-9698-47c8-b859-68240bead9d1",
  "typ": "synchron.register",
  "bdy": {
    "taskID": "bde3cead-74af-47f5-a0f5-de7d4f436324"
  }
}
```

The returned bdy.taskID is the ID of the registered task entry.   The calling service should retain that taskID value if it needs to deregister, suspend, resume or request the status of a registered task.

> Note, as of version 1.0.2: every executed task also receives a bdy.taskID.  This allows the recieving service to take control of task execution even if it wasn't the service that created the task.

#### synchron.deregister

A registered task may be deregistered using the taskID recieved during the registration process.

```javascript
{
  "to": "hydra-synchron-svcs:/",
  "frm": "some-other-svcs:/",
  "mid": "f6d23d41-9698-47c8-b859-68240bead9d1",
  "typ": "synchron.deregister",
  "bdy": {
    "taskID": "bde3cead-74af-47f5-a0f5-de7d4f436324"
  }
}
```

The same response above is returned to the sender upon successful deregistration.

#### synchron.suspend

A registered task may be suspended using the taskID recieved during the registration process.

```javascript
{
  "to": "hydra-synchron-svcs:/",
  "frm": "some-other-svcs:/",
  "mid": "f6d23d41-9698-47c8-b859-68240bead9d1",
  "typ": "synchron.suspend",
  "bdy": {
    "taskID": "bde3cead-74af-47f5-a0f5-de7d4f436324"
  }
}
```

The same response above is returned to the sender upon successful suspension.

The `to` and `frm` fields are reversed upon receipt.

If an error occurs the bdy.taskID will blank since no task was registered, and an bdy.error will indicated the error encounted.

#### synchron.resume

A registered and previously suspended task may be resumed using the taskID recieved during the registration process.

```javascript
{
  "to": "hydra-synchron-svcs:/",
  "frm": "some-other-svcs:/",
  "mid": "f6d23d41-9698-47c8-b859-68240bead9d1",
  "typ": "synchron.resume",
  "bdy": {
    "taskID": "bde3cead-74af-47f5-a0f5-de7d4f436324"
  }
}
```

The same response above is returned to the sender upon successful resuming of a previously suspended task.

The `to` and `frm` fields are reversed upon receipt.

If an error occurs the bdy.taskID will be retained and an bdy.error will indicated the error encounted.

#### synchron.status

A registered task may be queuried for status using the taskID recieved during the registration process.

```javascript
{
  "to": "hydra-synchron-svcs:/",
  "frm": "some-other-svcs:/",
  "mid": "f6d23d41-9698-47c8-b859-68240bead9d1",
  "typ": "synchron.status",
  "bdy": {
    "taskID": "bde3cead-74af-47f5-a0f5-de7d4f436324"
  }
}
```

The sending service will be sent a returned message with the status of the task:

```javascript
{
  "to": "client:/",
  "frm": "hydra-synchron-svcs:/",
  "mid": "89964657-ec2c-44a0-baec-d983c42cbd21",
  "ts": "2020-11-27T18:04:32.503Z",
  "typ": "synchron.status",
  "ver": "UMF/1.4.6",
  "bdy": {
    "taskID": "bde3cead-74af-47f5-a0f5-de7d4f436324",
    "targetTime": "2020-11-27T18:04:36.162Z",
    "suspended": false,
    "lastExecution": "2020-11-27T18:04:31.159Z"
  }
}
```

The `to` and `frm` fields are reversed upon receipt.

If an error occurs the bdy.taskID will be retained and an bdy.error will indicated the error encounted.

## Rules

During a task registration process the UMF.bdy field must contain a `rule` object.
Here's fragment from the example we saw earlier:

```javascript
  "bdy": {
    "rule": {
      "frequency": "every 15 hours",
      "sendType": "queue",
      "broadcast": false,
      "updateMid": true,
      "updateFrm": true
    },
```

The required fields are `frequency` and `sendType`.  The `broadcast`, `updateMid` and `updateFrm` fields are optional.

#### frequency

The `frequency` field contains simple English phrases such as:

* every 10 seconds
* every 1 minutes
* every 15 hours
* every 2 days
* every 1 months

The `every` word can be omitted or optionally replaced with the word `in` to create a task that executes only once at the specified duration.

* in 10 seconds
* in 1 minutes
* in 15 hours
* in 2 days
* in 1 months

> Important: the plural form of time should be used even when the duration is singular.  So `1 second` should be `1 seconds`.

Synchron uses the moment.js library to implement the above functionality.

| Key	| Shorthand |
|---|---|
| years |	y |
| quarters | Q|
| months | M |
| weeks	| w |
| days | d |
| hours	| h |
| minutes	| m |
| seconds	| s |

Above from the [Moment.js](https://momentjs.com/docs/#/manipulating/add/) documentation

> Important: The use of tasks frequencies of under a second (i.e. milliseconds) is NOT supported.

> Additionally: When using frequencies of under a minute (i.e. seconds) keep in mind that the time a task is set to execute is dependant on when it was recieved by the Synchron service and not when it was sent by the sending service.  Although message queuing occurs in sub-millisecond timeframes, a heavily overloaded system might encounter latencies.  Your load testing efforts should help you identify latencies in your specific applications and architectures.

#### sendType

The `sendType` field can be set to either `queue` or `send`.  This cooresponds to the use of either Hydra Queuing or Hydra SendMessage.

When omitted: `broadcast` is set to false, and the `updateMid` and `updateFrm` fields are set to true.

> Important: when `sendType` is set to `queue` then `broadcast` is automatically set to `false` since broadcasting only applies to Hydra.sendMessage and doesn't apply to queuing.

#### update fields

The `updateMid` field is optional and defaults to `true`.  When true, the field will be updated with a new MID upon execution.

The `updateFrm` fields is also optional and defaults to `true`. When true, the field will be updated to indicate that the message is originating from the `hydra-synchron-svcs:/` service.  Set `updateFrm` to false if you want to retain the original sender's service route.
## Executable Task

As we've seen earlier, an executable task consists of both a `rule` and a `message`.

```javascript
{
  "to": "hydra-synchron-svcs:/",
  "frm": "some-other-svcs:/",
  "mid": "f6d23d41-9698-47c8-b859-68240bead9d1",
  "typ": "synchron.register",
  "bdy": {
    "rule": {
      "frequency": "every 15 hours",
      "sendType": "queue",
      "broadcast": false,
      "updateMid": true,
      "updateFrm": true
    },
    "message": {
      "to": "some-other-svcs:/",
      "frm": "some-other-svcs:/",
      "mid": "4a2c6968-90d7-4ede-b2d4-9c768ce46d49",
      "typ": "perform.sweep",
      "bdy": {
        "actions": {}
      }
    }
  }
}
```

> Important: It's important that the message remain relatively small (ideally under 256K) because the underlying queuing is implemented using Redis Pub/Sub.  In order to keep your task messages small, consider using a reference indicating which points to a data store your service is using.

## Additional requirements

* Task messages must be sent to the Synchron service via Hydra Queuing.  HTTP or Hydra Send Messaging is not currently supported.
  * This does not apply to the execution of tasks which do support both queuing and sending.
* All task messages must be in ["short-form" UMF format](https://github.com/pnxtech/umf/blob/master/umf.md#6-short-form-syntax).
