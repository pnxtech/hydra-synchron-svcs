# hydra-synchron-svcs
Hydra synchronization Service

## Raison d'être
This service exists to solve the following key distributed computing problem.

> "How does a microservice type (with many instances) perform singular periodic tasks while avoiding the duplication of work?"

Consider:
  * If you put a timer inside of a microservice so that it can execute periodic tasks - then how do you prevent multiple instances of that service for each performing the same periodic task?
  * How do you ensure that the scheduled task executes on time?

## How it works:
The Hydra-synchron-svcs seeks to address this problem for all services within a cluster using the following methods:

* Tasks are registered with the Synchron service.
* Tasks can be registered by a sending service for itself or another service.
* A task is a UMF message with an embedded UMF sub-message.
* Tasks have an execution rule which defines when and how messages are sent to a service.
* All tasks are stored in a MongoDB database allowing for the synchron service to be restarted.
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
#### synchron.deregister
#### synchron.suspend
#### synchron.resume
#### synchron.status
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


## Executable Task

## Additional requirements
* Task messages must be send via Hydra Queuing.  HTTP or Hydra Send Messaging is not currently supported.
* All task message must be in UMF format.
