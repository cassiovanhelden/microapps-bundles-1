const limit = 50

async function fullSync(params) {
    params.context.siteIds = await getSiteIds(params)

    await Promise.all([syncMachines(params), syncSessions(params)])
}

async function incrementalSync(params) {
    await Promise.all([syncMachines(params), syncSessions(params)])
}

async function syncMachines(params) {
    let continuationToken
    const fields =
        'Id,AgentVersion,AssociatedUsers,MachineCatalog,DeliveryGroup,DnsName,InMaintenanceMode,IPAddress,MachineType,LastConnectionFailure,LastConnectionTime,LastConnectionUser,LastDeregistrationReason,LastDeregistrationTime,LastErrorReason,LastErrorTime,Name,OSType,OSVersion,PersistUserChanges,PowerState,ProvisioningType,RegistrationState,ScheduledReboot,SessionClientAddress,SessionClientName,SessionCount,SessionProtocol,SessionStartTime,SessionState,SessionStateChangeTime,SessionSupport,SessionUserName,SummaryState,WillShutdownAfterUse,WindowsConnectionSetting,Zone,FaultState'

    let body = '{}'

    if (params.latestSynchronizationTime) {
        body = `{\ 
            "SearchFilters":[\
                {\
                    "Property":"FaultState",\
                    "Value":"None",\
                    "Operator":"NotEquals"\
                }\
            ]\
        }`
        console.log('Incremental sync of Machines started.')
    } else {
        console.log('Sync of Machines started.')
    }

    for (const siteId of params.context.siteIds) {
        do {
            const response = await request(
                siteId,
                params,
                'Machines',
                continuationToken,
                fields,
                body,
            )

            try {
                if (response.ContinuationToken) {
                    continuationToken = response.ContinuationToken
                } else {
                    continuationToken = null
                }

                const machines = response.Items

                if (Array.isArray(machines) && machines.length > 0) {
                    for (const machine of machines) {
                        flatJson(machine, 'DeliveryGroup')
                        flatJson(machine, 'LastConnectionUser')
                        flatJson(machine, 'MachineCatalog')
                        flatJson(machine, 'Zone')
                        machine.Site_Id = siteId

                        // Store Associated Users for the Machine.
                        if (machine.AssociatedUsers && machine.AssociatedUsers.length > 0) {
                            const machines_associated_users = machine.AssociatedUsers.map(user => {
                                user.Machine_Id = machine.Id
                                return user
                            })
                            params.dataStore.save(
                                'machine_associated_user',
                                machines_associated_users,
                            )
                        }
                    }
                    params.dataStore.save('machine', machines)
                } else {
                    console.log(
                        'WARNING: Endpoint Machines - Response is empty or in wrong format.',
                    )
                }
            } catch (error) {
                console.error(error)
            }
        } while (continuationToken)
    }

    console.log('Sync of Machines finished.')
}

async function syncSessions(params) {
    let continuationToken
    const fields =
        'Id,ApplicationsInUse,AppState,Client,Connection,Machine,SessionType,StartTime,State,StateChangeTime,User'

    let body = `{
        "SearchFilters":[{\
            "Property": "SessionStateChangeTime",\
            "Value":"LastMonth",\
            "Operator":"IsWithin"\
        }]\
    }`

    if (params.latestSynchronizationTime) {
        body = `{\
            "SearchFilters":[{\
                "Property": "SessionStateChangeTime",\
                "Value":"Last30Minutes",\
                "Operator":"IsWithin"\ 
            }]\
        }`
        console.log('Incremental sync of Sessions started.')
    } else {
        console.log('Sync of Sessions started.')
    }

    for (const siteId of params.context.siteIds) {
        do {
            const response = await request(
                siteId,
                params,
                'Sessions',
                continuationToken,
                fields,
                body,
            )

            try {
                if (response.ContinuationToken) {
                    continuationToken = response.ContinuationToken
                } else {
                    continuationToken = null
                }
                const sessions = response.Items

                if (Array.isArray(sessions) && sessions.length > 0) {
                    for (const session of sessions) {
                        flatJson(session, 'Client')
                        flatJson(session, 'Connection')
                        flatJson(session, 'User')
                        flatJson(session, 'Machine')
                        flatJson(session, 'Machine_DeliveryGroup')
                        flatJson(session, 'Machine_MachineCatalog')
                        flatJson(session, 'Machine_Zone')

                        // Store Applications In Use for the Session.
                        if (session.ApplicationsInUse && session.ApplicationsInUse.length > 0) {
                            const sessions_applications_in_use = session.ApplicationsInUse.map(
                                app => {
                                    app.Session_Id = session.Id
                                    return app
                                },
                            )
                            params.dataStore.save(
                                'session_app_in_use',
                                sessions_applications_in_use,
                            )
                        }
                    }
                    params.dataStore.save('session', sessions)
                } else {
                    console.log(
                        'WARNING: Endpoint Sessions - Response is empty or in wrong format.',
                    )
                }
            } catch (error) {
                console.error(error)
            }
        } while (continuationToken)
    }

    console.log('Sync of Sessions finished.')
}

async function getSiteIds({client, integrationParameters}) {
    console.log('Started getting Site Ids.')

    let response = await client.fetch('/me', {
        headers: {
            'Content-Type': 'application/json',
            'Citrix-CustomerId': integrationParameters.customerId,
        },
    })

    if (!response.ok) {
        throw new Error(`Getting Site IDs failed(${response.status}: ${response.statusText})`)
    }

    response = await response.json()

    const siteIds = []

    try {
        response.Customers.forEach(customer =>
            customer.Sites.forEach(site => siteIds.push(site.Id)),
        )
    } catch (err) {
        console.error(err)
    }

    console.log('Finished getting Site IDs')

    return siteIds
}

async function request(
    siteId,
    {client, integrationParameters},
    entity,
    continuationToken,
    fields,
    body,
) {
    let path = `${siteId}/${entity}/$search?fields=${fields}&limit=${limit}`

    if (continuationToken) {
        path = `${path}&continuationToken=${continuationToken}`
    }
    const response = await client.fetch(path, {
        method: 'POST',
        body: body,
        headers: {
            'Content-Type': 'application/json',
            'Citrix-CustomerId': integrationParameters.customerId,
        },
    })

    if (!response.ok) {
        throw new Error(
            `Endpoint ${entity} - Request failed(${response.status}: ${response.statusText})`,
        )
    }
    console.log(entity + ' - response received, status: ' + response.status)

    return response.json()
}

function flatJson(json, oName) {
    if (json[oName] != undefined) {
        Object.entries(json[oName]).map(([key, value]) => (json[oName + '_' + key] = value))
        delete json[oName]
    }
    return json
}

integration.define({
    synchronizations: [
        {
            name: 'sync',
            fullSyncFunction: fullSync,
            incrementalSyncFunction: incrementalSync,
        },
    ],
    model: {
        tables: [
            {
                name: 'machine',
                columns: [
                    {
                        name: 'AgentVersion',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'DeliveryGroup_Id',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'DeliveryGroup_Name',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'DnsName',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'FaultState',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'Id',
                        type: 'STRING',
                        length: 255,
                        primaryKey: true,
                    },
                    {
                        name: 'InMaintenanceMode',
                        type: 'BOOLEAN',
                    },
                    {
                        name: 'IPAddress',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'LastConnectionFailure',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'LastConnectionTime',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'LastConnectionUser_DisplayName',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'LastConnectionUser_Domain',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'LastConnectionUser_Name',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'LastConnectionUser_PrincipalName',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'LastDeregistrationReason',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'LastDeregistrationTime',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'LastErrorReason',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'LastErrorTime',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'MachineCatalog_Id',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'MachineCatalog_Name',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'MachineType',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'Name',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'OSType',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'OSVersion',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'PersistUserChanges',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'PowerState',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'ProvisioningType',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'RegistrationState',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'ScheduledReboot',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'SessionClientAddress',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'SessionClientName',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'SessionCount',
                        type: 'INTEGER',
                    },
                    {
                        name: 'SessionProtocol',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'SessionStartTime',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'SessionState',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'SessionStateChangeTime',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'SessionSupport',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'SessionUserName',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'SummaryState',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'WillShutdownAfterUse',
                        type: 'BOOLEAN',
                    },
                    {
                        name: 'WindowsConnectionSetting',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'Zone_Id',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'Zone_Name',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'Site_Id',
                        type: 'STRING',
                        length: 255,
                    },
                ],
            },
            {
                name: 'machine_associated_user',
                columns: [
                    {
                        name: 'Machine_Id',
                        type: 'STRING',
                        length: 255,
                        primaryKey: true,
                    },
                    {
                        name: 'DisplayName',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'Domain',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'Name',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'PrincipalName',
                        type: 'STRING',
                        length: 255,
                        primaryKey: true,
                    },
                ],
            },
            {
                name: 'session',
                columns: [
                    {
                        name: 'AppState',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'Client_Name',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'Connection_ConnectionMode',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'Id',
                        type: 'STRING',
                        length: 255,
                        primaryKey: true,
                    },
                    {
                        name: 'Machine_DeliveryGroup_Name',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'Machine_DnsName',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'Machine_MachineCatalog_Name',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'Machine_Name',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'Machine_SessionCount',
                        type: 'INTEGER',
                    },
                    {
                        name: 'Machine_SessionSupport',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'Machine_SummaryState',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'Machine_Zone_Name',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'SessionType',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'StartTime',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'State',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'StateChangeTime',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'User_DisplayName',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'User_Name',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'User_PrincipalName',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'Site_Id',
                        type: 'STRING',
                        length: 255,
                    },
                ],
            },
            {
                name: 'session_app_in_use',
                columns: [
                    {
                        name: 'Session_Id',
                        type: 'STRING',
                        length: 255,
                        primaryKey: true,
                    },
                    {
                        name: 'Id',
                        type: 'STRING',
                        length: 255,
                    },
                    {
                        name: 'Name',
                        type: 'STRING',
                        length: 255,
                        primaryKey: true,
                    },
                ],
            },
        ],
        relationships: [
            {
                name: 'machine_user',
                primaryTable: 'machine',
                foreignTable: 'machine_associated_user',
                columnPairs: [
                    {
                        primaryKey: 'Id',
                        foreignKey: 'Machine_Id',
                    },
                ],
            },
            {
                name: 'session_app',
                primaryTable: 'session',
                foreignTable: 'session_app_in_use',
                columnPairs: [
                    {
                        primaryKey: 'Id',
                        foreignKey: 'Session_Id',
                    },
                ],
            },
        ],
    },
    integrationParameters: [
        {
            name: 'customerId',
            label: 'Customer ID',
            type: 'STRING',
            required: true,
        },
    ],
})
