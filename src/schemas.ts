import { z } from 'zod';
import type {
  HackerNewsId,
  HackerNewsIdList,
  HackerNewsItem,
  HackerNewsItemType,
  HackerNewsUpdates,
  HackerNewsUser,
  HackerNewsUsername,
} from './types';

/**
 * @file Defines schemas for Hacker News API responses using Zod.
 *
 * This file contains TypeScript definitions and Zod schemas for validating
 * Hacker News API responses. The schemas include definitions for Hacker News
 * item IDs, item types, items, users, and updates.
 *
 * Schemas:
 * - `HackerNewsIdSchema`: Schema for a Hacker News item ID.
 * - `HackerNewsIdListSchema`: Schema for a list of Hacker News item IDs.
 * - `HackerNewsItemTypeSchema`: Schema for the type of a Hacker News item.
 * - `HackerNewsItemSchema`: Schema for a Hacker News item.
 * - `HackerNewsUserSchema`: Schema for a Hacker News user.
 * - `HackerNewsUpdatesSchema`: Schema for Hacker News updates.
 */

export const HackerNewsIdSchema = z
  .number({
    required_error: 'Item ID is required',
    invalid_type_error: 'Item ID must be a number',
  })
  .int({ message: 'Item ID must be an integer' })
  .nonnegative({ message: 'Item ID must be a non-negative number' }) satisfies z.ZodType<HackerNewsId>;

export const HackerNewsUsernameSchema = z
  .string({
    required_error: 'Username is required',
    invalid_type_error: 'Username must be a string',
  })
  .min(1, { message: 'Username cannot be empty' }) satisfies z.ZodType<HackerNewsUsername>;

export const HackerNewsIdListSchema = z.array(HackerNewsIdSchema, {
  required_error: 'ID list is required',
  invalid_type_error: 'ID list must be an array of item IDs',
}) satisfies z.ZodType<HackerNewsIdList>;

// HackerNewsItemType as an enum.
export const HackerNewsItemTypeSchema = z.enum(['job', 'story', 'comment', 'poll', 'pollopt'], {
  required_error: 'Item type is required',
  invalid_type_error: 'Invalid item type. Must be one of: job, story, comment, poll, or pollopt',
}) satisfies z.ZodType<HackerNewsItemType>;

export const HackerNewsItemSchema = z.object(
  {
    /** The item's unique id. */
    id: z.number({
      required_error: 'Item ID is required',
      invalid_type_error: 'Item ID must be a number',
    }),
    /** True if the item is deleted. */
    deleted: z
      .boolean({
        invalid_type_error: 'Deleted flag must be a boolean',
      })
      .optional(),
    /** The type of item. */
    type: HackerNewsItemTypeSchema.optional(),
    /** The username of the item's author. */
    by: z
      .string({
        invalid_type_error: 'Author username must be a string',
      })
      .optional(),
    /** Creation date of the item, in Unix time. */
    time: z
      .number({
        invalid_type_error: 'Creation time must be a number (Unix timestamp)',
      })
      .optional(),
    /** The comment, story or poll text (HTML). */
    text: z
      .string({
        invalid_type_error: 'Text content must be a string',
      })
      .optional(),
    /** True if the item is dead. */
    dead: z
      .boolean({
        invalid_type_error: 'Dead flag must be a boolean',
      })
      .optional(),
    /** The comment's parent id: either another comment or the related story. */
    parent: z
      .number({
        invalid_type_error: 'Parent ID must be a number',
      })
      .optional(),
    /** For pollopts, the associated poll id. */
    poll: z
      .number({
        invalid_type_error: 'Poll ID must be a number',
      })
      .optional(),
    /** The ids of the item's comments, in ranked display order. */
    kids: z
      .array(
        z.number({
          invalid_type_error: 'Comment ID must be a number',
        }),
        {
          invalid_type_error: 'Kids must be an array of comment IDs',
        },
      )
      .optional(),
    /** The URL of the story. */
    url: z
      .string({
        invalid_type_error: 'URL must be a string',
      })
      .optional(),
    /** The story's score, or the votes for a pollopt. */
    score: z
      .number({
        invalid_type_error: 'Score must be a number',
      })
      .optional(),
    /** The title of the story, poll or job (HTML). */
    title: z
      .string({
        invalid_type_error: 'Title must be a string',
      })
      .optional(),
    /** A list of related pollopts, in display order. */
    parts: z
      .array(
        z.number({
          invalid_type_error: 'Poll option ID must be a number',
        }),
        {
          invalid_type_error: 'Parts must be an array of poll option IDs',
        },
      )
      .optional(),
    /** In the case of stories or polls, the total comment count. */
    descendants: z
      .number({
        invalid_type_error: 'Descendants count must be a number',
      })
      .optional(),
  },
  {
    required_error: 'Item object is required',
    invalid_type_error: 'Item must be an object',
  },
) satisfies z.ZodType<HackerNewsItem>;

// HackerNewsUser schema.
export const HackerNewsUserSchema = z.object(
  {
    /** The user's unique username. Case-sensitive. */
    id: HackerNewsUsernameSchema,
    /** Creation date of the user, in Unix Time. */
    created: z.number({
      required_error: 'User creation date is required',
      invalid_type_error: 'User creation date must be a number (Unix timestamp)',
    }),
    /** The user's karma. */
    karma: z.number({
      required_error: 'User karma is required',
      invalid_type_error: 'User karma must be a number',
    }),
    /** The user's optional self-description (HTML). */
    about: z
      .string({
        invalid_type_error: 'User about text must be a string',
      })
      .optional(),
    /** List of the user's stories, polls, and comments. */
    submitted: HackerNewsIdListSchema.optional(),
  },
  {
    required_error: 'User object is required',
    invalid_type_error: 'User must be an object',
  },
) satisfies z.ZodType<HackerNewsUser>;

// HackerNewsUpdates schema.
export const HackerNewsUpdatesSchema = z.object(
  {
    /** List of recent changes to the item. */
    items: HackerNewsIdListSchema.describe('List of recently changed items'),
    /** A list of user names that have changed recently. */
    profiles: z
      .array(HackerNewsUsernameSchema, {
        required_error: 'Profiles list is required',
        invalid_type_error: 'Profiles must be an array of usernames',
      })
      .describe('List of recently changed user profiles'),
  },
  {
    required_error: 'Updates object is required',
    invalid_type_error: "Updates must be an object with 'items' and 'profiles' fields",
  },
) satisfies z.ZodType<HackerNewsUpdates>;
