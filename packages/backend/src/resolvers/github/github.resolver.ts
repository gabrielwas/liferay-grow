import jsonwebtoken from 'jsonwebtoken';
import request, { Options } from 'request-promise';
import { Arg, Mutation, Query, Resolver } from 'type-graphql';
import { promisify } from 'util';

import { Github } from '../../entity/Github';
import { User } from '../../entity/User';
import { logger } from '../../utils/globalMethods';

const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, JWT_SECRET } = process.env;

const options: Options | any = {
  headers: {
    'User-Agent': 'Liferay Grow Together',
  },
  json: true,
};

const getGithubUser = async (code: string): Promise<any> => {
  const baseURL = 'https://github.com/login/oauth/access_token';
  const url = `${baseURL}?code=${code}&client_id=${GITHUB_CLIENT_ID}&client_secret=${GITHUB_CLIENT_SECRET}`;

  const response = await request.post(url.toString());

  if (response.includes('access_token=')) {
    const access_token = response.split('=')[1].split('&').shift();
    const githubUser = await request.get('https://api.github.com/user', {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `token ${access_token}`,
      },
    });

    return githubUser;
  } else {
    throw new Error('Something went wrong');
  }
};

const belongsToLiferayOrg = async (username: string): Promise<boolean> => {
  try {
    const organizations: Array<any> = await request(
      `https://api.github.com/users/${username}/orgs`,
      options,
    );

    const liferayOrg = organizations.find((org) => org.login === 'liferay');

    return !!liferayOrg;
  } catch (e) {
    return false;
  }
};

const assignToken = async (payload: any): Promise<string> => {
  const token = await promisify(jsonwebtoken.sign)(
    { ...payload },
    JWT_SECRET as string,
  );

  return token as string;
};

@Resolver(Github)
export class GithubResolver {
  @Query(() => [Github], { name: 'getAllGithubs' })
  async getAllGithubs(): Promise<Github[]> {
    const githubs = await Github.find({ relations: ['user'] });

    return githubs;
  }

  @Mutation(() => String, { name: 'authGithub' })
  async authGithub(@Arg('code') code: string): Promise<string> {
    const githubUser = await getGithubUser(code);
    const {
      avatar_url,
      bio,
      company,
      email,
      id: accountId,
      location,
      login,
      name,
    } = githubUser;

    const user = await Github.findOne({
      relations: ['user'],
      where: {
        login,
      },
    });

    let token = '';

    if (user) {
      token = await assignToken(user);
    } else {
      const isLiferayMember = await belongsToLiferayOrg(login);

      if (!isLiferayMember) {
        throw new Error('not-a-liferay-member');
      }

      const newUser = await User.create().save();
      const newGithub = await Github.create({
        accountId,
        avatar_url,
        bio,
        company,
        email,
        location,
        login,
        name,
        user: newUser,
      }).save();

      newUser.github = newGithub;

      token = await assignToken(newGithub);

      await newUser.save();
    }

    logger.info(`Token generated for ${login}`);

    return token;
  }
}
