# hydra-synchron-svcs
A [Hydra-based](https://github.com/pnxtech/hydra) synchronization Service

<img src="assets/synchron.png" width="300px" />
## Raison d'être
This service exists to solve the following key distributed computing problem.

> "How does a microservice type (with many instances) perform singular periodic tasks while avoiding the duplication of work?"

Consider:
  * If you put a timer inside of a microservice so that it can execute periodic tasks - then how do you prevent multiple instances of that service for each performing the same periodic task?
  * How do you ensure that the scheduled task executes on time?

Why not just use a job service? With Hydra, job / task queuing is present by default.  So microservices can queue jobs for themselves or each other - at will.  The problem this service solves is one of the creation and management of system-wide periodic orchestration events.

## How it works:
The Hydra-synchron-svcs seeks to address this problem for all services within a cluster using the following methods:

* Tasks are registered with the Synchron service.
* Tasks can be registered by a sending service for itself or another service.
* A task is a [UMF message](https://github.com/pnxtech/umf/blob/master/umf.md) with an embedded UMF sub-message.
* Tasks have an execution rule which defines when and how messages are sent to a service.
* All tasks are stored in a Mongo database allowing for the synchron service to be restarted.
* When a task is ready for execution, Synchron can either use a `hydra.sendMessage` or `hydra.queueMessage` to notify the intended recipient service.  The notification is essentially just the registered sub-message.

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
      "updateFrm": true,
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
Synchron can be sent one of the following types of tasks.

| Type | Usage |
|------|-------|
| synchron.register | First time registration of a task |
| synchron.deregister | Remove a registered task |
| synchron.suspend | Suspect a registered task |
| synchron.resume | Resume a registered task |
| synchron.status | Get the status of a registered task |

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
      "updateFrm": true,
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
  "to": "some-other-svcs:/",
  "frm": "hydra-synchron-svcs:/",
  "mid": "f6d23d41-9698-47c8-b859-68240bead9d1",
  "typ": "synchron.status",
  "bdy": {
    "taskID": "bde3cead-74af-47f5-a0f5-de7d4f436324",
    "status": "one of the status messages below"
  }
}
```

Status messages:

* `queued`: Queued means that the task was queued and set to execute when ready.
* `suspended`: Suspended means that the task was queued but currently suspended.
* `not found`: Not found means that either the task does not exists given the supplied taskID or the task was an execute "once" task which was completed and thus no longer exists.

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
      "updateFrm": true,
    },
```

The required fields are `frequency` and `sendType`.  The `broadcast`, `updateMid` and `updateFrm` fields are optional.

#### frequency
The `frequency` field contains simple English phrases such as:

* every 10 seconds
* every 1 minute
* every 15 hours
* every 2 days
* every 1 month

The `every` word can be omitted or optionally replaced with the word `in` to create a task that executes only once at the specified duration.

* in 10 seconds
* in 1 minute
* in 15 hours
* in 2 days
* in 1 month

#### sendType
The `sendType` field can be set to either `queue` or `send`.  This cooresponds to the use of either Hydra Queuing or Hydra SendMessage.

When omitted: `broadcast` is set to false, and the `updateMid` and `updateFrm` fields are set to true.

> Important: when `sendType` is set to `queue` then `broadcast` is automatically set to `false` since broadcasting only applies to Hydra.sendMessage and doesn't apply to queuing.

#### update fields
The `updateMid` field is optional and defaults to `true`.  When true, the field will be updated with a new MID upon execution.

The `updateFrm` fields is also optional and defaults to `true`. When true, the field will be updated to indicate that the message is originating from the `hydra-synchron-svcs:/` service.  Set `updateFrm` to false if you want to retain the original sender's service route.
## Executable Task

## Additional requirements
* Task messages must be sent to the Synchron service via Hydra Queuing.  HTTP or Hydra Send Messaging is not currently supported.
  * This does not apply to the execution of tasks which do support both queuing and sending.
* All task message must be in ["short-form" UMF format](https://github.com/pnxtech/umf/blob/master/umf.md#6-short-form-syntax).
