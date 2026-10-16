import i18next from "i18next";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Helmet } from 'react-helmet';
import { useTranslation } from "react-i18next";
import { FlatActionButton, FlatPanel, Modal, SearchableSelect } from "@rin/ui";
import { ShowAlertType, useAlert, useConfirm } from "../components/dialog";
import { Input } from "../components/input";
import { ImageWithFallback } from "../components/image-with-fallback";
import { Waiting } from "../components/loading";
import { client } from "../app/runtime";
import { ClientConfigContext } from "../state/config";
import { ProfileContext } from "../state/profile";

import { useSiteConfig } from "../hooks/useSiteConfig";
import { siteName } from "../utils/constants";


type FriendItem = {
    name: string;
    category?: FriendCategory;
    id: number;
    uid: number;
    avatar: string;
    createdAt: string;
    updatedAt: string;
    desc: string | null;
    url: string;
    accepted: number;
    health: string;
    sort_order?: number | null;
};

const DEFAULT_FRIEND_CATEGORIES = ["软件导航", "实用工具", "未分类"] as const;
const CUSTOM_FRIEND_CATEGORIES_KEY = "rin.my-friends.categories";
type FriendCategory = string;
type MoveDirection = -1 | 1;

function readCustomFriendCategories() {
    if (typeof window === "undefined") return [];

    try {
        const categories: unknown = JSON.parse(localStorage.getItem(CUSTOM_FRIEND_CATEGORIES_KEY) ?? "[]");
        return Array.isArray(categories)
            ? categories.filter((category): category is string =>
                typeof category === "string" && category.trim().length > 0
            )
            : [];
    } catch {
        return [];
    }
}

function encodeFriendName(name: string) {
    return `[分组2]${name}`;
}

function encodeFriendDescription(category: FriendCategory, desc: string) {
    if (category === "未分类") return desc.length <= 100 ? desc : null;

    const categoryMetadata = `[[rin-category:${category.length}:${category}]]`;
    const encodedDescription = `${categoryMetadata}${desc}`;
    return encodedDescription.length <= 100 ? encodedDescription : null;
}

function decodeFriend(item: FriendItem) {
    let category = "未分类";
    let desc = item.desc ?? "";
    const metadataMatch = /^\[\[rin-category:(\d+):/.exec(desc);

    if (metadataMatch) {
        const categoryStart = metadataMatch[0].length;
        const categoryEnd = categoryStart + Number(metadataMatch[1]);
        if (desc.slice(categoryEnd, categoryEnd + 2) === "]]" ) {
            category = desc.slice(categoryStart, categoryEnd);
            desc = desc.slice(categoryEnd + 2);
        }
    }

    const nameWithoutGroup = item.name.replace(/^\[分组2\]/, "");
    const legacyCategoryMatch = /^\[([^\]]+)\]/.exec(nameWithoutGroup);
    if (category === "未分类" && legacyCategoryMatch) {
        try {
            category = decodeURIComponent(legacyCategoryMatch[1]);
        } catch {
            category = legacyCategoryMatch[1];
        }
    }

    return {
        ...item,
        category,
        desc,
        name: legacyCategoryMatch ? nameWithoutGroup.slice(legacyCategoryMatch[0].length) : nameWithoutGroup,
    };
}

async function publish({ name, category, avatar, desc, url, showAlert }: { name: string, category: FriendCategory, avatar: string, desc: string, url: string, showAlert: ShowAlertType }) {
    const t = i18next.t
    const encodedDescription = encodeFriendDescription(category, desc);
    if (name.length + "[分组2]".length > 20 || !encodedDescription) {
        showAlert("链接名称或描述过长，请缩短后重试")
        return
    }
    const { error } = await client.friend.create({
        avatar,
        name: encodeFriendName(name),
        desc: encodedDescription,
        url
    })
    if (error) {
        showAlert(error.value as string)
    } else {
        showAlert(t('create.success'), () => {
            window.location.reload()
        })
    }
}

async function persistFriendOrder(friends: FriendItem[], showAlert: ShowAlertType) {
    const updates: { friend: FriendItem; desc: string; sortOrder: number }[] = []
    for (const [index, friend] of friends.entries()) {
        const desc = encodeFriendDescription(friend.category ?? "未分类", friend.desc ?? "")
        if (friend.name.length + "[分组2]".length > 20 || !desc) {
            showAlert("链接名称或描述过长，无法保存排序")
            return
        }
        updates.push({ friend, desc, sortOrder: friends.length - index })
    }

    const results = await Promise.all(updates.map(({ friend, desc, sortOrder }) =>
        client.friend.update(friend.id, {
            name: encodeFriendName(friend.name),
            desc,
            avatar: friend.avatar,
            url: friend.url,
            sort_order: sortOrder,
        })
    ))
    const failedUpdate = results.find((result) => result.error)
    if (failedUpdate?.error) {
        showAlert(failedUpdate.error.value as string)
        return
    }

    window.location.reload()
}

export function MyFriendsPage() {
    const { t } = useTranslation()
    const siteConfig = useSiteConfig();
    const config = useContext(ClientConfigContext)
    let [apply] = useState<FriendItem>()
    const [name, setName] = useState("")
    const [category, setCategory] = useState<FriendCategory>("")
    const [customCategories, setCustomCategories] = useState<string[]>(readCustomFriendCategories)
    const [newCategory, setNewCategory] = useState("")
    const [desc, setDesc] = useState("")
    const [avatar, setAvatar] = useState("")
    const [url, setUrl] = useState("")
    const profile = useContext(ProfileContext);
    const [friendsAvailable, setFriendsAvailable] = useState<FriendItem[]>([])
    const [allFriends, setAllFriends] = useState<FriendItem[]>([])
    const [waitList, setWaitList] = useState<FriendItem[]>([])
    const [refusedList, setRefusedList] = useState<FriendItem[]>([])
    const [friendsUnavailable, setFriendsUnavailable] = useState<FriendItem[]>([])
    const [status, setStatus] = useState<'idle' | 'loading'>('loading')
    const ref = useRef(false)
    const { showAlert, AlertUI } = useAlert()
    const { showConfirm, ConfirmUI } = useConfirm()
    useEffect(() => {
        if (ref.current) return
        client.friend.list().then(({ data }) => {
            if (data) {
                const friend_list = (data.friend_list || [])
                    .filter((item) => item.name.startsWith("[分组2]"))
                    .map(decodeFriend)
                    setAllFriends(friend_list as FriendItem[])
                const friends_available = friend_list.filter(({ health, accepted }: any) => health.length === 0 && accepted === 1) || []
                setFriendsAvailable(friends_available as any)
                const friends_unavailable = friend_list.filter(({ health, accepted }: any) => health.length > 0 && accepted === 1) || []
                setFriendsUnavailable(friends_unavailable as any)
                const waitList = friend_list.filter(({ accepted }: any) => accepted === 0) || []
                setWaitList(waitList as any)
                const refuesdList = friend_list.filter(({ accepted }: any) => accepted === -1) || []
                setRefusedList(refuesdList as any)
            }
            setStatus('idle')
        })
        ref.current = true
    }, [])
    const friendCategories = [...new Set([
        ...DEFAULT_FRIEND_CATEGORIES,
        ...customCategories,
        ...friendsAvailable.map((friend) => friend.category).filter((value): value is string => Boolean(value)),
    ])]
    const orderedFriendCategories = [...friendCategories].sort((left, right) => {
        const leftOrder = Math.max(0, ...friendsAvailable
            .filter((friend) => friend.category === left)
            .map((friend) => friend.sort_order ?? 0))
        const rightOrder = Math.max(0, ...friendsAvailable
            .filter((friend) => friend.category === right)
            .map((friend) => friend.sort_order ?? 0))
        return rightOrder - leftOrder
    })
    const visibleFriendCategories = orderedFriendCategories.filter((friendCategory) =>
        friendsAvailable.some((friend) => friend.category === friendCategory)
    )
    function getSortedCategoryFriends(friendCategory: string) {
        return [...friendsAvailable
            .filter((friend) => friend.category === friendCategory)
        ].sort((left, right) => (right.sort_order ?? 0) - (left.sort_order ?? 0))
    }
    function moveCategory(friendCategory: string, direction: -1 | 1) {
        const index = visibleFriendCategories.indexOf(friendCategory)
        const targetIndex = index + direction
        if (index < 0 || targetIndex < 0 || targetIndex >= visibleFriendCategories.length) return

        const nextCategories = [...visibleFriendCategories]
        ;[nextCategories[index], nextCategories[targetIndex]] = [nextCategories[targetIndex], nextCategories[index]]
        const orderedFriends = nextCategories.flatMap(getSortedCategoryFriends)
        void persistFriendOrder(orderedFriends, showAlert)
    }
    function moveFriend(friendId: number, direction: -1 | 1) {
        const friend = friendsAvailable.find((item) => item.id === friendId)
        if (!friend?.category) return

        const categoryFriends = getSortedCategoryFriends(friend.category)
        const index = categoryFriends.findIndex((item) => item.id === friendId)
        const targetIndex = index + direction
        if (index < 0 || targetIndex < 0 || targetIndex >= categoryFriends.length) return

        ;[categoryFriends[index], categoryFriends[targetIndex]] = [categoryFriends[targetIndex], categoryFriends[index]]
        const orderedFriends = visibleFriendCategories.flatMap((friendCategory) =>
            friendCategory === friend.category ? categoryFriends : getSortedCategoryFriends(friendCategory)
        )
        void persistFriendOrder(orderedFriends, showAlert)
    }
    function moveFriendToPosition(friendId: number, position: number) {
        const friend = friendsAvailable.find((item) => item.id === friendId)
        if (!friend?.category) return

        const categoryFriends = getSortedCategoryFriends(friend.category)
        const currentIndex = categoryFriends.findIndex((item) => item.id === friendId)
        const targetIndex = position - 1
        if (currentIndex < 0 || targetIndex < 0 || targetIndex >= categoryFriends.length || currentIndex === targetIndex) return

        const [movingFriend] = categoryFriends.splice(currentIndex, 1)
        categoryFriends.splice(targetIndex, 0, movingFriend)
        const orderedFriends = visibleFriendCategories.flatMap((friendCategory) =>
            friendCategory === friend.category ? categoryFriends : getSortedCategoryFriends(friendCategory)
        )
        void persistFriendOrder(orderedFriends, showAlert)
    }
    function addCategory() {
        const nextCategory = newCategory.trim()
        if (!nextCategory) return

        if (!friendCategories.includes(nextCategory)) {
            const nextCategories = [...customCategories, nextCategory]
            setCustomCategories(nextCategories)
            try {
                localStorage.setItem(CUSTOM_FRIEND_CATEGORIES_KEY, JSON.stringify(nextCategories))
            } catch {}
        }

        setCategory(nextCategory)
        setNewCategory("")
    }
    function deleteCategory(categoryToDelete: string) {
        const removeCategory = () => {
            const nextCategories = customCategories.filter((value) => value !== categoryToDelete)
            setCustomCategories(nextCategories)
            try {
                localStorage.setItem(CUSTOM_FRIEND_CATEGORIES_KEY, JSON.stringify(nextCategories))
            } catch {}
            if (category === categoryToDelete) setCategory("")
        }
        const categorizedFriends = allFriends.filter((friend) => friend.category === categoryToDelete)

        if (categorizedFriends.length === 0) {
            removeCategory()
            return
        }

        showConfirm(
            "删除分类",
            `分类“${categoryToDelete}”中有 ${categorizedFriends.length} 个友链，删除后会移到“未分类”。`,
            async () => {
                const results = await Promise.all(categorizedFriends.map((friend) =>
                    client.friend.update(friend.id, {
                        avatar: friend.avatar,
                        name: encodeFriendName(friend.name),
                        desc: encodeFriendDescription("未分类", friend.desc ?? "") ?? "",
                        url: friend.url,
                        accepted: friend.accepted,
                        sort_order: friend.sort_order ?? 0,
                    })
                ))
                const failedUpdate = results.find((result) => result.error)
                if (failedUpdate?.error) {
                    showAlert(failedUpdate.error.value as string)
                    return
                }

                removeCategory()
                window.location.reload()
            }
        )
    }
    function publishButton() {
        if (!category) {
            showAlert("请先选择分类")
            return
        }
        publish({ name, category, desc, avatar, url, showAlert })
    }
    return (<>
        <Helmet>
            <title>{`导航 - ${siteConfig.name}`}</title>
            <meta property="og:site_name" content={siteName} />
            <meta property="og:title" content="导航" />
            <meta property="og:image" content={siteConfig.avatar} />
            <meta property="og:type" content="article" />
            <meta property="og:url" content={document.URL} />
        </Helmet>
        <Waiting for={friendsAvailable.length !== 0 || friendsUnavailable.length !== 0 || status === "idle"}>
            <main className="w-full flex flex-col justify-center items-center mb-8 t-primary ani-show">
                {visibleFriendCategories.map((friendCategory, index) => {
                    const categorizedFriends = getSortedCategoryFriends(friendCategory)
                    return (
                        <FriendList
                            key={friendCategory}
                            title={friendCategory}
                            show={categorizedFriends.length > 0}
                            friends={categorizedFriends}
                            onMoveFriend={profile?.permission ? moveFriend : undefined}
                            onMoveFriendToPosition={profile?.permission ? moveFriendToPosition : undefined}
                            onMoveCategory={profile?.permission ? (direction) => moveCategory(friendCategory, direction) : undefined}
                            canMoveCategoryUp={index > 0}
                            canMoveCategoryDown={index < visibleFriendCategories.length - 1}
                        />
                    )
                })}
                <FriendList title={t('friends.left')} show={friendsUnavailable.length > 0} friends={friendsUnavailable} />
                <FriendList title={t('friends.review.waiting')} show={waitList.length > 0} friends={waitList} />
                <FriendList title={t('friends.review.rejected')} show={refusedList.length > 0} friends={refusedList} />
                <FriendList title={t('friends.my_apply')} show={profile?.permission !== true && apply !== undefined} friends={apply ? [apply] : []} />
                {profile && (profile.permission || config.get("friend_apply_enable")) &&
                    <div className="wauto t-primary flex text-start text-2xl font-bold mt-8">
                        <FlatPanel className="md:basis-1/2 p-6">
                            <p>
                                {profile.permission ? t('friends.create') : t('friends.apply')}
                            </p>
                            <div className="text-sm mt-4 text-neutral-500 font-normal">
                                <SearchableSelect
                                    value={category}
                                    onChange={(nextValue) => setCategory(nextValue as FriendCategory)}
                                    options={friendCategories.map((value) => ({ label: value, value }))}
                                    placeholder="请选择分类"
                                    searchPlaceholder="请选择分类"
                                />
                                {profile.permission && <>
                                    <div className="mt-2 flex items-center gap-2">
                                        <Input
                                            value={newCategory}
                                            setValue={setNewCategory}
                                            placeholder="输入新分类名称"
                                            variant="flat"
                                            className="min-w-0 flex-1"
                                        />
                                        <FlatActionButton
                                            type="button"
                                            onClick={addCategory}
                                            disabled={!newCategory.trim()}
                                        >
                                            新增分类
                                        </FlatActionButton>
                                    </div>
                                    {customCategories.map((customCategory) => (
                                        <div key={customCategory} className="mt-2 flex items-center justify-between gap-3">
                                            <span className="truncate text-sm">{customCategory}</span>
                                            <FlatActionButton
                                                type="button"
                                                onClick={() => deleteCategory(customCategory)}
                                                className="shrink-0 text-theme"
                                            >
                                                <i className="ri-delete-bin-line mr-1" aria-hidden="true" />
                                                删除分类
                                            </FlatActionButton>
                                        </div>
                                    ))}
                                </>}
                                <Input value={name} setValue={setName} placeholder={t('sitename')} variant="flat" />
                                <Input value={desc} setValue={setDesc} placeholder={t('description')} variant="flat" className="mt-2" />
                                <Input value={avatar} setValue={setAvatar} placeholder={t('avatar.url')} variant="flat" className="mt-2" />
                                <Input value={url} setValue={setUrl} placeholder={t('url')} variant="flat" className="my-2" />
                                <div className='flex flex-row justify-center'>
                                    <button onClick={publishButton} disabled={!category} className='basis-1/2 rounded-full bg-theme py-4 text-white disabled:opacity-50'>{t('create.title')}</button>
                                </div>
                            </div>
                        </FlatPanel>
                    </div>
                }
            </main>
        </Waiting>
        <ConfirmUI />
        <AlertUI />
    </>)
}

function FriendList({
    title,
    show,
    friends,
    onMoveFriend,
    onMoveFriendToPosition,
    onMoveCategory,
    canMoveCategoryUp,
    canMoveCategoryDown,
}: {
    title: string;
    show: boolean;
    friends: FriendItem[];
    onMoveFriend?: (friendId: number, direction: MoveDirection) => void;
    onMoveFriendToPosition?: (friendId: number, position: number) => void;
    onMoveCategory?: (direction: MoveDirection) => void;
    canMoveCategoryUp?: boolean;
    canMoveCategoryDown?: boolean;
}) {
    return (<>
        {
            show && <>
                <div className="wauto text-start py-4">
                    <div className="flex items-center gap-2">
                        <p className="text-sm mt-4 text-neutral-500 font-normal">{title}</p>
                        {onMoveCategory && <div className="flex items-center gap-1">
                            <button
                                type="button"
                                aria-label="上移分类"
                                title="上移分类"
                                disabled={!canMoveCategoryUp}
                                onClick={() => onMoveCategory(-1)}
                                className="p-1 text-neutral-500 hover:text-theme disabled:opacity-30"
                            >
                                <i className="ri-arrow-up-s-line" aria-hidden="true" />
                            </button>
                            <button
                                type="button"
                                aria-label="下移分类"
                                title="下移分类"
                                disabled={!canMoveCategoryDown}
                                onClick={() => onMoveCategory(1)}
                                className="p-1 text-neutral-500 hover:text-theme disabled:opacity-30"
                            >
                                <i className="ri-arrow-down-s-line" aria-hidden="true" />
                            </button>
                        </div>}
                    </div>
                </div>
                <div className="wauto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {friends.map((friend, index) => (
                        <Friend
                            key={friend.id}
                            friend={friend}
                            position={index + 1}
                            friendCount={friends.length}
                            onMoveUp={onMoveFriend ? () => onMoveFriend(friend.id, -1) : undefined}
                            onMoveDown={onMoveFriend ? () => onMoveFriend(friend.id, 1) : undefined}
                            onMoveToPosition={onMoveFriendToPosition
                                ? (position) => onMoveFriendToPosition(friend.id, position)
                                : undefined}
                        />
                    ))}
                </div>
            </>
        }
    </>)
}

function Friend({
    friend,
    position,
    friendCount,
    onMoveUp,
    onMoveDown,
    onMoveToPosition,
}: {
    friend: FriendItem;
    position: number;
    friendCount: number;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    onMoveToPosition?: (position: number) => void;
}) {
    const { t } = useTranslation()
    const profile = useContext(ProfileContext)
    const [avatar, setAvatar] = useState(friend.avatar)
    const [name, setName] = useState(friend.name)
    const [category, setCategory] = useState<FriendCategory>(friend.category ?? "未分类")
    const categoryOptions = [...new Set([
        ...DEFAULT_FRIEND_CATEGORIES,
        ...readCustomFriendCategories(),
        category,
    ])]
    const [desc, setDesc] = useState(friend.desc || "")
    const [url, setUrl] = useState(friend.url)
    const [status, setStatus] = useState(friend.accepted)
    const [modalIsOpen, setIsOpen] = useState(false);
    const { showConfirm, ConfirmUI } = useConfirm()
    const { showAlert, AlertUI } = useAlert()

    const deleteFriend = useCallback(() => {
        showConfirm(
            t('delete.title'),
            t('delete.confirm'),
            () => {
                client.friend.delete(friend.id).then(({ error }) => {
                    if (error) {
                        showAlert(error.value as string)
                    } else {
                        showAlert(t('delete.success'), () => {
                            window.location.reload()
                        })
                    }
                })
            })
    }, [friend.id])

    const updateFriend = useCallback(() => {
        const encodedDescription = encodeFriendDescription(category, desc)
        if (name.length + "[分组2]".length > 20 || !encodedDescription) {
            showAlert("链接名称或描述过长，请缩短后重试")
            return
        }

        client.friend.update(friend.id, {
            avatar,
            name: encodeFriendName(name),
            desc: encodedDescription,
            url,
            accepted: status
        }).then(({ error }) => {
            if (error) {
                showAlert(error.value as string)
            } else {
                showAlert(t('update.success'), () => {
                    window.location.reload()
                })
            }
        })
    }, [avatar, name, category, desc, url, status])

    const statusOption = [
        { value: -1, label: t('friends.review.rejected') },
        { value: 0, label: t('friends.review.waiting') },
        { value: 1, label: t('friends.review.accepted') }
    ]
    return (
        <>
            <a title={friend.name} href={friend.url} target="_blank" rel="noopener noreferrer" className="relative flex min-w-0 w-full flex-col items-center justify-center overflow-hidden rounded-xl bg-w p-4 bg-button">
                <ImageWithFallback
                    className="h-16 w-16 rounded-full"
                    imageClassName={friend.health.length > 0 ? "grayscale" : ""}
                    src={friend.avatar}
                    alt={friend.name}
                />
                <p className="mt-1 max-w-full truncate text-center text-base">{friend.name}</p>
                {friend.health.length == 0 && <p className="line-clamp-2 max-w-full text-center text-sm text-neutral-500 [overflow-wrap:anywhere]">{friend.desc}</p>}
                {friend.accepted !== 1 && <p className={`${friend.accepted === 0 ? "t-primary" : "text-theme"}`}>{statusOption[friend.accepted + 1].label}</p>}
                {friend.health.length > 0 && <p className="max-w-full text-center text-sm text-gray-500 [overflow-wrap:anywhere]">{errorHumanize(friend.health)}</p>}
                {(profile?.permission || profile?.id === friend.uid) && <>
                    <button onClick={(e) => { e.preventDefault(); setIsOpen(true) }} className="absolute top-0 right-0 m-2 px-2 py-1 bg-secondary t-primary rounded-full bg-button">
                        <i className="ri-settings-line"></i>
                    </button></>}
            </a>

            <Modal
                isOpen={modalIsOpen}
                onRequestClose={() => setIsOpen(false)}
                contentLabel={t('update$sth', { sth: friend.name })}
                panelClassName="overflow-visible p-6"
            >
                <div className="relative flex w-full flex-col items-center justify-start">
                    <ImageWithFallback
                        className="h-16 w-16 rounded-xl"
                        imageClassName={friend.health.length > 0 ? "grayscale" : ""}
                        src={friend.avatar}
                        alt={friend.name}
                    />
                    {(onMoveUp || onMoveDown) && <div className="mt-3 flex items-center justify-end gap-2">
                        <span className="text-sm text-neutral-500">链接顺序</span>
                        <button
                            type="button"
                            aria-label="上移链接"
                            title="上移链接"
                            disabled={!onMoveUp}
                            onClick={onMoveUp}
                            className="p-2 text-neutral-500 hover:text-theme disabled:opacity-30"
                        >
                            <i className="ri-arrow-up-s-line" aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            aria-label="下移链接"
                            title="下移链接"
                            disabled={!onMoveDown}
                            onClick={onMoveDown}
                            className="p-2 text-neutral-500 hover:text-theme disabled:opacity-30"
                        >
                            <i className="ri-arrow-down-s-line" aria-hidden="true" />
                        </button>
                    </div>}
                    {profile?.permission &&
                        <div className="flex flex-col w-full items-start mt-4 px-4">
                            <SearchableSelect
                                value={category}
                                onChange={(nextValue) => setCategory(nextValue as FriendCategory)}
                                options={categoryOptions.map((value) => ({ label: value, value }))}
                                placeholder="选择分类"
                                searchPlaceholder="选择分类"
                            />
                            <div className="flex flex-row justify-between w-full items-center">
                                <div className="flex flex-col">
                                    <p className="text-lg dark:text-white">
                                        {t('status')}
                                    </p>
                                </div>
                                <div className="flex flex-row items-center justify-center space-x-4">
                                    <SearchableSelect
                                        value={String(status)}
                                        onChange={(nextValue) => {
                                            const parsed = Number(nextValue)
                                            if (!Number.isNaN(parsed)) {
                                                setStatus(parsed)
                                            }
                                        }}
                                        options={statusOption.map((option) => ({
                                            label: option.label,
                                            value: String(option.value),
                                        }))}
                                        placeholder={t('status')}
                                        searchPlaceholder={t('status')}
                                    />
                                </div>
                            </div>
                            <div className="flex flex-row justify-between w-full items-center mt-2">
                                <div className="flex flex-col">
                                    <p className="text-lg dark:text-white">分类内位置</p>
                                </div>
                                <div className="flex flex-row items-center justify-center space-x-4">
                                    <SearchableSelect
                                        value={String(position)}
                                        onChange={(nextValue) => {
                                            const nextPosition = Number(nextValue)
                                            if (!Number.isNaN(nextPosition)) onMoveToPosition?.(nextPosition)
                                        }}
                                        options={Array.from({ length: friendCount }, (_, index) => ({
                                            label: `第 ${index + 1} 位`,
                                            value: String(index + 1),
                                        }))}
                                        placeholder="选择位置"
                                        searchPlaceholder="选择位置"
                                    />
                                </div>
                            </div>
                        </div>
                    }
                    <Input value={name} setValue={setName} placeholder={t('sitename')} variant="flat" className="mt-4" />
                    <Input value={desc} setValue={setDesc} placeholder={t('description')} variant="flat" className="mt-2" />
                    <Input value={avatar} setValue={setAvatar} placeholder={t('avatar.url')} variant="flat" className="mt-2" />
                    <Input value={url} setValue={setUrl} placeholder={t('url')} variant="flat" className="my-2" />
                    <div className='flex flex-row justify-center space-x-2'>
                        <FlatActionButton onClick={deleteFriend} className="mt-2 text-theme">{t('delete.title')}</FlatActionButton>
                        <FlatActionButton onClick={updateFriend} className="mt-2 t-primary">{t('save')}</FlatActionButton>
                    </div>
                </div>
            </Modal>
            <ConfirmUI />
            <AlertUI />
        </>
    )
}

function errorHumanize(error: string) {
    if (error === "certificate has expired" || error == "526") {
        return "证书已过期"
    } else if (error.includes("Unable to connect") || error == "521" || error == "522") {
        return "无法访问"
    }
    return error
}
