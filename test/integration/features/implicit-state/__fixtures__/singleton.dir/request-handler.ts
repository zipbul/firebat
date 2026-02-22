import { Logger } from './logger';

export const logRequest = () => {
  const logger = Logger.getInstance();
  logger.info('request received');
};
