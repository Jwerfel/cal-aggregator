# cal-aggregator
A very simple calendar aggregator

## Development
1. Copy ```config.sample.json``` to ```config.json```
2. Modify ```config.json``` to include 1 or more calendars
3. Modify the ```apiKey``` value in ```config.json```
4. Run the following
```
npm install
npm start
```
5. Open a browser and go to 

```http://localhost:3000/calendar.ics?key=<apiKey>```


## Production
1. Git clone ```https://github.com/Jwerfel/cal-aggregator.git```
2. Copy ```config.sample.json``` to ```config.json``` and modify ```config.json``` as needed
3. Copy ```docker-compose-sample.yml``` to ```docker-compose.yml```. Modify ```docker-compose.yml``` if needed
4. Run 
```
docker-compose up -d --build
```
