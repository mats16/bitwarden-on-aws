import { CloudFormationCustomResourceHandler, CloudFormationCustomResourceResponse } from 'aws-lambda'
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { Connection, ConnectionConfig, Request, RequestError } from 'tedious';
import axios from "axios";

const dbSecretArn: string = process.env.DB_SECRET_ARN;

const modifyConfig = async (dbSecretArn: string): Promise<ConnectionConfig> => {
  const client = new SecretsManagerClient({});
  const cmd = new GetSecretValueCommand({ SecretId: dbSecretArn });
  const dbSecret = await client.send(cmd);
  const { host, port, username, password } = JSON.parse(dbSecret.SecretString || '{}');
  const config: ConnectionConfig = {  
    server: host,
    authentication: {
        type: 'default',
        options: {
            userName: username,
            password: password
        }
    },
    options: {
        encrypt: false,
    }
  };
  return config
};

const modifyConnection = async (config: ConnectionConfig): Promise<Connection> => {
  const connection = new Connection(config)
  await new Promise(function(resolve, reject) {
    connection.on('connect', err => {
        if (err) {
            reject(err)
        } else {
            resolve(connection)
        }
    });
    connection.connect()
  });

  return connection
};

const execSql = async (connection: Connection, sql: string): Promise<any> => {
  const p = new Promise(function(resolve, reject) {
    const request = new Request(sql, (err, rowCount) => {
        if (err) {
          console.info(err);
          resolve(err)
        }
        console.log(`Success: ${sql}`);
        resolve(rowCount);
    });
    connection.execSql(request);
  });
  return p;
};

export const handler: CloudFormationCustomResourceHandler = async (event, context) => {
  const config = await modifyConfig(dbSecretArn);
  const connection = await modifyConnection(config);
  const databaseName: string = event.ResourceProperties.DatabaseName;

  if (event.RequestType === 'Create') {
    await execSql(connection, `CREATE DATABASE ${databaseName};`);
  } else if (event.RequestType === 'Update') {
    const oldDatabaseName = event.OldResourceProperties.DatabaseName
    await execSql(connection, `CREATE DATABASE ${databaseName};`);
    await execSql(connection, `DROP DATABASE ${oldDatabaseName};`);
  } else if (event.RequestType === 'Delete') {
    await execSql(connection, `DROP DATABASE ${databaseName};`);
  };
  connection.close();
  const response: CloudFormationCustomResourceResponse = {
    Status: 'SUCCESS',
    RequestId: event.RequestId,
    StackId: event.StackId,
    LogicalResourceId: event.LogicalResourceId,
    PhysicalResourceId: `${config.server}/${databaseName}`
  }
  await axios.put(event.ResponseURL, response, { headers: { "Content-Type": "application/json" } });
};
