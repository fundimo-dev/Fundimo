// imports to help with certain functions in the app
import * as path from 'path'; // helps with ensuring right folders are opened and used no matter the OS (used to build file paths in an OS safe way)
import { ValidationPipe } from '@nestjs/common'; // Helps to validate the data that is sent to the API
import { HttpAdapterHost } from '@nestjs/core'; // Allows the app to communicate with the underlying web server
// Gives acces to the underlying HTTP layer so the global exception filter can shape respones & give cutom outputs

import { NestFactory } from '@nestjs/core'; // Created an instance of the app 
import cookieParser from 'cookie-parser'; // Helps with reading and writing cookies 
import { config as loadEnv } from 'dotenv'; // Helps with loading the .env files into the environment like API keys and secrets
import { AppModule } from './app.module'; // Imports the AppModule file which is a container for all the modules
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter'; // Helps with global error handling 
import { validatePlaidEnv } from './plaid/plaid.config'; // Checks for Plaid credentials before the app runs

// Load apps/api/.env so env vars are available before Nest and when running from repo root
const envPath = path.join(__dirname, '..', '.env'); // Looks one folder up for .env to load API keys and secrets to be ready to use
loadEnv({ path: envPath });  // loads the .env file into the enironment 

async function bootstrap() { // bootstrap function that is used to start the app
  validatePlaidEnv();
   // Runs a credential check for Plaid before the app runs
   // startup validation
   // prevents app from starting if Plaid credentials are not set/misconfigured state
  const app = await NestFactory.create(AppModule); // uses await to pause and wiat for nest factory to create the instance of the app
  app.setGlobalPrefix('api'); // sets the global prefix for the app to /api
  // ex --> your.domain.com/api/...
  // used for versioning 

//Security and CORS(Cross Origin Resource Sharing)
  const corsOrigin = process.env.CORS_ORIGIN ?? true; // A security feature for the frontend since it is outside of this environment
  // makes it so that frontend has to be give permission to talk to API
  // Browsers block cross-origin requests unless the server explicityly allows them
  // CORS tells the browser to allow requests from the frontend to the API

  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });

  app.use(cookieParser(process.env.CSRF_SECRET ?? 'fundimo-default-secret')); // initializes the cookie tool
  // Specifically: parses incoming cookie headers into req.cookies object
  // without this, JWT cookies would not be readable 
  const httpAdapterHost = app.get(HttpAdapterHost); // 
  app.useGlobalFilters(new AllExceptionsFilter(httpAdapterHost)); // allows error catcher from line 8 to be used globally 


  // ValidationPipe for the data that is sent to the API
  app.useGlobalPipes( //"is this data valid?" 
    // incoming JSON converted to DTO classes, types checked, required fields validated, If fail -> 400 Bad Request
    new ValidationPipe({ // transforms incoming JSON into DTO class instances (ex: { email: 'test@test.com', password: 'password' } -> { email: 'test@test.com', password: 'password' })
                        // Validates types and constraints (class validator decorators)
                        // strips unkown properties (if configured with whitelist)
      whitelist: true, // removes any properties that are not defined in the DTO (Data Transfer Object)
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = process.env.PORT ?? 3000; // looks for the port in the .env file, if not found, uses 3000
  await app.listen(port, '0.0.0.0');
  console.log(`Fundimo API listening on port ${port}`); // logs the port to the console showing that the server is running
}

bootstrap(); // calls the bootstrap function to start the app

